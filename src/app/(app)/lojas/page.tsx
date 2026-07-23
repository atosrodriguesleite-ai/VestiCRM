import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";
import { PageHeader } from "@/components/ui";
import { LojasView, type Loja } from "./lojas-view";
import { JueriTeste } from "./jueri-teste";
import { catalogDomain } from "@/lib/catalog-url";
import { spNow } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function LojasPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const companies = await db.company.findMany({
    where: { slug: { not: PLATFORM_SLUG } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, customers: true, orders: true } },
      billing: true,
      users: {
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { name: true, email: true },
      },
    },
  });

  // Uso: último acesso real por loja + quem foi + quantos entraram nos 7 dias.
  const usuarios = await db.user.findMany({
    where: { company: { slug: { not: PLATFORM_SLUG } } },
    select: { companyId: true, name: true, lastActiveAt: true },
  });
  const seteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const usoByCompany = new Map<
    string,
    { at: Date | null; name: string | null; ativos7: number }
  >();
  for (const u of usuarios) {
    const cur = usoByCompany.get(u.companyId) ?? { at: null, name: null, ativos7: 0 };
    if (u.lastActiveAt) {
      if (!cur.at || u.lastActiveAt > cur.at) {
        cur.at = u.lastActiveAt;
        cur.name = u.name;
      }
      if (u.lastActiveAt.getTime() >= seteDias) cur.ativos7 += 1;
    }
    usoByCompany.set(u.companyId, cur);
  }

  // Recebido no mês atual (fuso de São Paulo) — soma dos pagamentos registrados.
  const sp = spNow();
  const inicioMes = new Date(Date.UTC(sp.y, sp.m - 1, 1, 3, 0, 0));
  const recebido = await db.billingPayment.aggregate({
    _sum: { amount: true },
    where: { paidAt: { gte: inicioMes } },
  });
  const recebidoMes = recebido._sum.amount ?? 0;

  // comprovantes do termo do WhatsApp sem API + estado da conexão por loja
  const [consents, connections] = await Promise.all([
    db.whatsappConsent.findMany({ orderBy: { acceptedAt: "desc" } }),
    db.commSettings.findMany({
      select: { companyId: true, evolutionStatus: true, evolutionPhone: true },
    }),
  ]);
  const consentByCompany = new Map(
    [...consents].reverse().map((c) => [c.companyId, c]) // o mais antigo = 1º aceite
  );
  const connByCompany = new Map(connections.map((c) => [c.companyId, c]));

  const lojas: Loja[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    createdAt: c.createdAt.toISOString(),
    admin: c.users[0] ?? null,
    users: c._count.users,
    customers: c._count.customers,
    orders: c._count.orders,
    waConsent: (() => {
      const w = consentByCompany.get(c.id);
      return w
        ? {
            userName: w.userName,
            userEmail: w.userEmail,
            acceptedAt: w.acceptedAt.toISOString(),
            ip: w.ip,
            termVersion: w.termVersion,
          }
        : null;
    })(),
    waStatus: connByCompany.get(c.id)?.evolutionStatus ?? "DESCONECTADO",
    waPhone: connByCompany.get(c.id)?.evolutionPhone ?? null,
    productionEnabled: c.productionEnabled,
    marketingEnabled: c.marketingEnabled,
    mediaLibraryEnabled: c.mediaLibraryEnabled,
    suspended: c.suspended,
    billing: c.billing
      ? {
          kind: c.billing.kind,
          implementationFee: c.billing.implementationFee,
          implementationPaid: c.billing.implementationPaid,
          implementationPaidAt: c.billing.implementationPaidAt?.toISOString() ?? null,
          monthlyFee: c.billing.monthlyFee,
          dueDay: c.billing.dueDay,
          paidThrough: c.billing.paidThrough?.toISOString() ?? null,
          notes: c.billing.notes,
        }
      : null,
    lastActiveAt: usoByCompany.get(c.id)?.at?.toISOString() ?? null,
    lastActiveName: usoByCompany.get(c.id)?.name ?? null,
    active7: usoByCompany.get(c.id)?.ativos7 ?? 0,
  }));

  // Resumo da operação comercial da plataforma (leads do site)
  const platform = await db.company.findUnique({
    where: { slug: PLATFORM_SLUG },
    select: { id: true },
  });
  const [newLeads, siteLeads] = platform
    ? await Promise.all([
        db.opportunity.count({
          where: { companyId: platform.id, status: "OPEN", stage: { name: "Novo Lead" } },
        }),
        db.customer.count({ where: { companyId: platform.id } }),
      ])
    : [0, 0];

  // Canal de aquisição "Bio": leads que chegaram pelo rodapé "feito por
  // atacadopro.com" das bios das lojas (landingSource = "bio:<slug>").
  const bioLeads = platform
    ? await db.customer.findMany({
        where: { companyId: platform.id, landingSource: { startsWith: "bio" } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, name: true, phone: true, landingSource: true, createdAt: true },
      })
    : [];
  const bioLeadsTotal = platform
    ? await db.customer.count({
        where: { companyId: platform.id, landingSource: { startsWith: "bio" } },
      })
    : 0;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Painel do Super Admin"
        subtitle="Gerencie suas lojas clientes e os leads que chegam pela Landing Page. Cada loja nasce com funil, cores e tamanhos prontos e um login de administrador."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Lojas cadastradas</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{lojas.length}</p>
        </div>
        <Link
          href="/funil"
          className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop hover:border-brand-200"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Novos leads do site</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-600">{newLeads}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">aguardando contato →</p>
        </Link>
        <Link
          href="/clientes"
          className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop hover:border-brand-200"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Leads do site (total)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{siteLeads}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">ver todos →</p>
        </Link>
      </div>

      {/* Canal de aquisição: leads vindos das bios (Gestor de Bio das lojas) */}
      {bioLeadsTotal > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-slate-800">
                <span className="grid size-7 place-items-center rounded-lg bg-brand-50 text-brand-600">🔗</span>
                Leads via Bio
              </h2>
              <p className="text-xs text-slate-500">
                Vieram do rodapé “feito por atacadopro.com” das bios das lojas.
              </p>
            </div>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-bold tabular-nums text-brand-700">
              {bioLeadsTotal}
            </span>
          </div>
          <div className="divide-y divide-slate-50">
            {bioLeads.map((l) => {
              const origem = l.landingSource?.startsWith("bio:") ? l.landingSource.slice(4) : null;
              return (
                <div key={l.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{l.name}</span>
                  {origem && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      bio: {origem}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                    {l.createdAt.toLocaleDateString("pt-BR")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <JueriTeste />
      <LojasView initial={lojas} catalogDomain={catalogDomain()} recebidoMes={recebidoMes} />
    </div>
  );
}
