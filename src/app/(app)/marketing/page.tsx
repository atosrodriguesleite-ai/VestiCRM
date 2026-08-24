import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Wallet, Receipt, Repeat, Target, Link2, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { brl, originLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/dash";
import { BarList, Donut, PeriodChips } from "@/components/charts";
import { CampaignsManager, type Campanha } from "./campaigns-manager";
import { refsDaCampanha } from "@/lib/ad-match";

export const dynamic = "force-dynamic";

// cor de cada canal de aquisição (para o donut/legendas)
const ORIGIN_COLOR: Record<string, string> = {
  WHATSAPP: "#10b981",
  INSTAGRAM: "#e1306c",
  FACEBOOK: "#3b5f8a",
  CATALOGO_PUBLICO: "#c4622d",
  NUVEMSHOP: "#14b8a6",
  SITE: "#7e6f5d",
  GOOGLE: "#e5b93c",
  TRAFEGO_PAGO: "#a04e21",
  INDICACAO: "#818cf8",
  INSTAGRAM_ORGANICO: "#e1306c",
};
const originColor = (o: string) => ORIGIN_COLOR[o] ?? "#a3937e";
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; canal?: string }>;
}) {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { marketingEnabled: true },
  });
  if (!company?.marketingEnabled) redirect("/dashboard");

  const { de, ate, canal } = await searchParams;
  const companyId = user.companyId;
  // filtro por canal: só aceita uma origem válida (senão, visão Geral)
  const canalParam = canal && canal in originLabel ? canal : null;
  const now = new Date();
  const SP_OFFSET = 3 * 60 * 60 * 1000; // São Paulo é UTC-3
  const spStart = (d?: string) => {
    const t = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
    return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
  };
  const spEnd = (d?: string) => {
    const t = d ? Date.parse(`${d}T23:59:59.999Z`) : NaN;
    return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
  };
  const from = spStart(de) ?? new Date(now.getTime() - 30 * 864e5);
  const to = spEnd(ate) ?? now;
  const inPeriod = { gte: from, lte: to };
  const durMs = Math.max(to.getTime() - from.getTime(), 1);
  const inPrev = { gte: new Date(from.getTime() - durMs), lte: new Date(from.getTime() - 1) };

  // buscamos TUDO do período (sem filtrar por canal) — o filtro por canal é
  // aplicado depois, em memória, para os cartões e o ranking. Assim os
  // gráficos "por canal" sempre mostram a comparação completa (visão Geral).
  const [leadsAll, prevLeadsAll, ordersAll, prevOrdersAll, campaignRows, buyerCounts] = await Promise.all([
    db.customer.findMany({ where: { companyId, createdAt: inPeriod }, select: { id: true, origin: true, campaignId: true } }),
    db.customer.findMany({ where: { companyId, createdAt: inPrev }, select: { origin: true } }),
    db.order.findMany({
      where: { companyId, status: { in: PAID_ORDER_STATUSES }, paidAt: inPeriod },
      select: { netTotal: true, customerId: true, customer: { select: { origin: true, campaignId: true } } },
    }),
    db.order.findMany({
      where: { companyId, status: { in: PAID_ORDER_STATUSES }, paidAt: inPrev },
      select: { netTotal: true, customer: { select: { origin: true } } },
    }),
    db.marketingCampaign.findMany({
      where: { companyId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, channel: true, utmKey: true, active: true, adRefs: true, _count: { select: { customers: true } } },
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        ...(canalParam ? { customer: { origin: canalParam as never } } : {}),
      },
      _count: { _all: true },
    }),
  ]);

  const campById = new Map(campaignRows.map((c) => [c.id, c]));

  // ANÚNCIOS DETECTADOS: clientes que chegaram clicando num anúncio
  // (Click-to-WhatsApp). Os que ainda não pertencem a nenhuma campanha ficam
  // na lista para a loja vincular com um clique — e o histórico vai junto.
  const idsLeadsPeriodo = leadsAll.map((l) => l.id);
  // as tres saem juntas: nenhuma depende da outra (velocidade, 20/08/2026)
  const [anunciosRaw, criativos, compradoresRaw] = await Promise.all([
    db.customer.groupBy({
      by: ["adRef"],
      where: { companyId, adRef: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    // o CRIATIVO de cada anúncio (link, título e texto). Sem isto a tela mostrava
    // só o código curto — que não abre nada e não diz que anúncio é.
    db.adCreative.findMany({
      where: { companyId },
      select: { adRef: true, sourceUrl: true, title: true, body: true },
    }),
    // CONVERSAO POR COORTE: "dos leads que entraram no periodo, quantos
    // compraram (a qualquer momento)". Antes era compradores-do-periodo /
    // leads-do-periodo — gente que virou lead mes passado e comprou agora
    // inflava a conta e a conversao passava de 100%.
    idsLeadsPeriodo.length
      ? db.order.groupBy({
          by: ["customerId"],
          where: {
            companyId,
            status: { in: PAID_ORDER_STATUSES },
            customerId: { in: idsLeadsPeriodo },
          },
        })
      : [],
  ]);
  const compradoresDaCoorte = new Set(compradoresRaw.map((o) => o.customerId));
  const refsJaUsadas = new Set(campaignRows.flatMap((c) => refsDaCampanha(c.adRefs)));
  const criativoDe = new Map(criativos.map((c) => [c.adRef, c]));
  const anunciosDetectados = anunciosRaw
    .filter((a) => a.adRef && !refsJaUsadas.has(a.adRef))
    .map((a) => {
      const cr = criativoDe.get(a.adRef as string);
      return {
        ref: a.adRef as string,
        clientes: a._count._all,
        ultimo: a._max.createdAt?.toISOString() ?? null,
        url: cr?.sourceUrl ?? null,
        titulo: cr?.title ?? null,
        texto: cr?.body ?? null,
      };
    })
    .sort((a, b) => b.clientes - a.clientes)
    .slice(0, 12);


  // ---- canais presentes (para os chips de filtro) ----
  const canaisSet = new Set<string>();
  for (const l of leadsAll) canaisSet.add(l.origin);
  for (const o of ordersAll) canaisSet.add(o.customer.origin);

  // ---- gráficos "por canal" (SEMPRE a visão geral/comparação) ----
  const canalLeads = new Map<string, number>();
  for (const l of leadsAll) canalLeads.set(l.origin, (canalLeads.get(l.origin) ?? 0) + 1);
  const canalFat = new Map<string, number>();
  for (const o of ordersAll) canalFat.set(o.customer.origin, (canalFat.get(o.customer.origin) ?? 0) + o.netTotal);
  const canais = [...canaisSet]
    .map((o) => ({
      origin: o,
      label: originLabel[o as keyof typeof originLabel] ?? o,
      color: originColor(o),
      leads: canalLeads.get(o) ?? 0,
      fat: canalFat.get(o) ?? 0,
    }))
    .sort((a, b) => b.fat - a.fat || b.leads - a.leads);

  // ---- aplica o filtro de canal (Geral = tudo) ----
  const leads = canalParam ? leadsAll.filter((l) => l.origin === canalParam) : leadsAll;
  const paidOrders = canalParam ? ordersAll.filter((o) => o.customer.origin === canalParam) : ordersAll;
  const prevLeadsList = canalParam ? prevLeadsAll.filter((l) => l.origin === canalParam) : prevLeadsAll;
  const prevOrdersList = canalParam ? prevOrdersAll.filter((o) => o.customer.origin === canalParam) : prevOrdersAll;

  // ---- agregação por CAMPANHA (respeita o filtro de canal) ----
  const campLeads = new Map<string, number>();
  const campConvertidos = new Map<string, number>(); // leads DA COORTE que compraram
  let leadsSemCamp = 0;
  for (const l of leads) {
    if (l.campaignId) {
      campLeads.set(l.campaignId, (campLeads.get(l.campaignId) ?? 0) + 1);
      if (compradoresDaCoorte.has(l.id))
        campConvertidos.set(l.campaignId, (campConvertidos.get(l.campaignId) ?? 0) + 1);
    } else leadsSemCamp += 1;
  }
  const campFat = new Map<string, { fat: number; pedidos: number; clientes: Set<string> }>();
  let fatSemCamp = 0;
  for (const o of paidOrders) {
    const cid = o.customer.campaignId;
    if (!cid) {
      fatSemCamp += o.netTotal;
      continue;
    }
    const cur = campFat.get(cid) ?? { fat: 0, pedidos: 0, clientes: new Set<string>() };
    cur.fat += o.netTotal;
    cur.pedidos += 1;
    cur.clientes.add(o.customerId);
    campFat.set(cid, cur);
  }
  const campanhasIds = new Set<string>([...campLeads.keys(), ...campFat.keys()]);
  const porCampanha = [...campanhasIds]
    .map((id) => {
      const c = campById.get(id);
      const f = campFat.get(id);
      const ld = campLeads.get(id) ?? 0;
      const clientes = f?.clientes.size ?? 0;
      return {
        id,
        name: c?.name ?? "Campanha removida",
        channel: c?.channel ?? "OUTRO",
        leads: ld,
        clientes,
        fat: f?.fat ?? 0,
        ticket: f && f.pedidos > 0 ? f.fat / f.pedidos : 0,
        // % dos leads que a campanha trouxe NO PERÍODO e que já compraram
        conversao: ld > 0 ? pct(campConvertidos.get(id) ?? 0, ld) : null,
      };
    })
    .sort((a, b) => b.fat - a.fat || b.leads - a.leads);

  // ---- números do topo (já filtrados pelo canal, quando houver) ----
  const totalLeads = leads.length;
  const totalFat = paidOrders.reduce((s, o) => s + o.netTotal, 0);
  const ticket = paidOrders.length > 0 ? totalFat / paidOrders.length : 0;
  const prevLeads = prevLeadsList.length;
  const prevRevenue = prevOrdersList.reduce((s, o) => s + o.netTotal, 0);
  // sem base no período anterior não dá pra calcular variação (mesma regra
  // do Dashboard — antes aqui devolvia "+100%", que era invenção)
  const pctDelta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const totalBuyers = buyerCounts.length;
  const repeatBuyers = buyerCounts.filter((b) => b._count._all >= 2).length;
  const recompra = totalBuyers > 0 ? Math.round((repeatBuyers / totalBuyers) * 100) : 0;

  // gráficos por canal usam a visão total (leadsAll), não o filtro
  const totalLeadsAll = leadsAll.length;
  // a rosca mostra os 6 maiores canais e agrupa o resto em "Outros" — antes
  // o 7º canal em diante era simplesmente descartado e as fatias não somavam
  // o valor do centro (auditoria 24/08/2026)
  const canaisComFat = [...canais.filter((c) => c.fat > 0)].sort((a, b) => b.fat - a.fat);
  const restoFat = canaisComFat.slice(6).reduce((s, c) => s + c.fat, 0);
  const donutData = [
    ...canaisComFat.slice(0, 6).map((c) => ({ label: c.label, value: c.fat, color: c.color })),
    ...(restoFat > 0 ? [{ label: "Outros canais", value: restoFat, color: "#94a3b8" }] : []),
  ];
  // mesma regra na barra de leads: 6 maiores POR LEADS (não por faturamento,
  // que é a ordem de `canais`) e o resto agrupado — cortar o 7º canal fazia
  // os % das barras não somarem 100%
  const canaisComLeads = [...canais.filter((c) => c.leads > 0)].sort((a, b) => b.leads - a.leads);
  const restoLeads = canaisComLeads.slice(6).reduce((s, c) => s + c.leads, 0);
  const leadsBar = [
    ...canaisComLeads.slice(0, 6).map((c) => ({ label: c.label, value: c.leads, sub: `${pct(c.leads, totalLeadsAll)}%` })),
    ...(restoLeads > 0
      ? [{ label: "Outros canais", value: restoLeads, sub: `${pct(restoLeads, totalLeadsAll)}%` }]
      : []),
  ];
  const canalLabel = canalParam ? (originLabel[canalParam as keyof typeof originLabel] ?? canalParam) : null;

  const campanhas: Campanha[] = campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    utmKey: c.utmKey,
    active: c.active,
    adRefs: c.adRefs,
    leads: c._count.customers,
  }));

  const semDados = totalLeads === 0 && totalFat === 0;

  // link do chip de canal preservando o período (de/ate)
  const canalHref = (origin: string | null) => {
    const p = new URLSearchParams();
    if (de) p.set("de", de);
    if (ate) p.set("ate", ate);
    if (origin) p.set("canal", origin);
    const s = p.toString();
    return `/marketing${s ? `?${s}` : ""}`;
  };
  const chipCls = (on: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      on
        ? "border-brand-600 bg-brand-600 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"
    }`;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Marketing"
        subtitle="De onde vêm seus clientes que compram — por canal e por campanha. Os números crescem conforme os vendedores marcam a campanha de cada lead."
      />

      {/* atalho para o Gestor de Bio (página de links do Instagram) */}
      <Link
        href="/marketing/bio"
        className="group flex items-center gap-3 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4 transition hover:border-brand-300 hover:shadow-card"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
          <Link2 className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-800">Gestor de Bio</span>
          <span className="block text-xs text-slate-500">Monte a sua página de links do Instagram, com a cara da sua loja.</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-brand-400 transition group-hover:translate-x-0.5" />
      </Link>

      {/* o canal escolhido viaja junto ao trocar o período (senão sumia) */}
      <PeriodChips
        pathname="/marketing"
        de={de}
        ate={ate}
        extra={{ canal: canalParam ?? undefined }}
      />

      {/* filtro por canal — Geral (tudo) ou um canal específico */}
      {canais.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Canal</p>
          <div className="flex flex-wrap gap-2 pb-1">
            <Link href={canalHref(null)} className={chipCls(!canalParam)}>
              Geral
            </Link>
            {canais.map((c) => (
              <Link key={c.origin} href={canalHref(c.origin)} className={chipCls(canalParam === c.origin)}>
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {canalLabel && (
        <p className="-mt-2 text-[13px] text-slate-500">
          Mostrando o canal <b className="text-slate-800">{canalLabel}</b>.{" "}
          <Link href={canalHref(null)} className="text-brand-600 hover:underline">
            Ver geral
          </Link>
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Leads no período" value={totalLeads} format="int" icon={<Users />} delta={pctDelta(totalLeads, prevLeads)} />
        <StatCard label="Faturamento" value={totalFat} format="brl" icon={<Wallet />} tone="good" delta={pctDelta(totalFat, prevRevenue)} />
        <StatCard label="Ticket médio" value={ticket} format="brl" icon={<Receipt />} />
        <StatCard label="Recompra" value={recompra} format="pct" icon={<Repeat />} hint="clientes que voltaram a comprar" info="Percentual dos clientes com compra que já fizeram 2 ou mais pedidos pagos (todo o histórico)." />
      </div>

      {semDados ? (
        <Card>
          <EmptyState
            icon={<Target />}
            title="Ainda sem dados neste período"
            hint="Assim que entrarem leads (com a campanha marcada no “Lead + link”) e pedidos pagos, os resultados por canal e campanha aparecem aqui."
          />
        </Card>
      ) : !canalParam ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* faturamento por canal */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Faturamento por canal</h3>
            {donutData.length > 0 ? (
              <Donut data={donutData} centerValue={brl(totalFat)} centerLabel="no período" formatValue={brl} />
            ) : (
              <p className="text-sm text-slate-400">Nenhuma venda paga no período.</p>
            )}
          </Card>

          {/* leads por canal */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Leads por canal</h3>
            {leadsBar.length > 0 ? (
              <BarList data={leadsBar} formatValue={(v) => String(v)} />
            ) : (
              <p className="text-sm text-slate-400">Nenhum lead no período.</p>
            )}
          </Card>
        </div>
      ) : null}

      {/* ranking por campanha */}
      {(porCampanha.length > 0 || leadsSemCamp > 0 || fatSemCamp > 0) && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Resultado por campanha</h3>

          {/* celular: cada campanha vira um cartão (cabe na tela) */}
          <div className="md:hidden space-y-2">
            {porCampanha.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-100 px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-800">{c.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{brl(c.fat)}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                  <span>Leads <b className="text-slate-700">{c.leads}</b></span>
                  <span>Compraram <b className="text-slate-700">{c.clientes}</b></span>
                  <span>Conv. <b className="text-slate-700">{c.conversao != null ? `${c.conversao}%` : "—"}</b></span>
                </div>
              </div>
            ))}
            {(leadsSemCamp > 0 || fatSemCamp > 0) && (
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm italic text-slate-400">Sem campanha (não identificado)</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-500">{brl(fatSemCamp)}</span>
                </div>
                <div className="text-xs text-slate-400">Leads <b className="text-slate-500">{leadsSemCamp}</b></div>
              </div>
            )}
          </div>

          {/* computador: tabela (inalterada) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Campanha</th>
                  <th className="py-2 px-3 text-right font-semibold tabular-nums">Leads</th>
                  <th className="py-2 px-3 text-right font-semibold tabular-nums">Compraram</th>
                  <th className="py-2 px-3 text-right font-semibold tabular-nums">Conv.</th>
                  <th className="py-2 pl-3 text-right font-semibold tabular-nums">Faturamento</th>
                </tr>
              </thead>
              <tbody>
                {porCampanha.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-slate-800">{c.name}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{c.leads}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{c.clientes}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-500">{c.conversao != null ? `${c.conversao}%` : "—"}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums font-semibold text-slate-800">{brl(c.fat)}</td>
                  </tr>
                ))}
                {(leadsSemCamp > 0 || fatSemCamp > 0) && (
                  <tr className="border-t border-slate-100 text-slate-400">
                    <td className="py-2.5 pr-3 italic">Sem campanha (não identificado)</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{leadsSemCamp}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">—</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">—</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums">{brl(fatSemCamp)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* gestão das campanhas */}
      <div className="pt-2">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Suas campanhas</h2>
        <CampaignsManager initial={campanhas} anuncios={anunciosDetectados} />
      </div>
    </div>
  );
}
