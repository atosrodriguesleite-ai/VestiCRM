import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";
import { PageHeader } from "@/components/ui";
import { LojasView, type Loja } from "./lojas-view";

export const dynamic = "force-dynamic";

export default async function LojasPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const companies = await db.company.findMany({
    where: { slug: { not: PLATFORM_SLUG } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, customers: true, orders: true } },
      users: {
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { name: true, email: true },
      },
    },
  });

  const lojas: Loja[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    createdAt: c.createdAt.toISOString(),
    admin: c.users[0] ?? null,
    users: c._count.users,
    customers: c._count.customers,
    orders: c._count.orders,
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

      <LojasView initial={lojas} />
    </div>
  );
}
