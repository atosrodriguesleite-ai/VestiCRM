import { redirect } from "next/navigation";
import { Users, Wallet, Receipt, Repeat, Target } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { brl, originLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/dash";
import { BarList, Donut, PeriodChips } from "@/components/charts";
import { CampaignsManager, type Campanha } from "./campaigns-manager";

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
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { marketingEnabled: true },
  });
  if (!company?.marketingEnabled) redirect("/dashboard");

  const { de, ate } = await searchParams;
  const companyId = user.companyId;
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

  const [leads, prevLeadsCount, paidOrders, prevFat, campaignRows, buyerCounts] = await Promise.all([
    db.customer.findMany({ where: { companyId, createdAt: inPeriod }, select: { origin: true, campaignId: true } }),
    db.customer.count({ where: { companyId, createdAt: inPrev } }),
    db.order.findMany({
      where: { companyId, status: { in: PAID_ORDER_STATUSES }, createdAt: inPeriod },
      select: { total: true, customerId: true, customer: { select: { origin: true, campaignId: true } } },
    }),
    db.order.aggregate({
      _sum: { total: true },
      where: { companyId, status: { in: PAID_ORDER_STATUSES }, createdAt: inPrev },
    }),
    db.marketingCampaign.findMany({
      where: { companyId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, channel: true, utmKey: true, active: true, _count: { select: { customers: true } } },
    }),
    db.order.groupBy({ by: ["customerId"], where: { companyId, status: { in: PAID_ORDER_STATUSES } }, _count: { _all: true } }),
  ]);

  const campById = new Map(campaignRows.map((c) => [c.id, c]));

  // ---- agregação por CANAL (origin) ----
  const canalLeads = new Map<string, number>();
  for (const l of leads) canalLeads.set(l.origin, (canalLeads.get(l.origin) ?? 0) + 1);
  const canalFat = new Map<string, { fat: number; pedidos: number }>();
  for (const o of paidOrders) {
    const k = o.customer.origin;
    const cur = canalFat.get(k) ?? { fat: 0, pedidos: 0 };
    cur.fat += o.total;
    cur.pedidos += 1;
    canalFat.set(k, cur);
  }
  const canaisSet = new Set<string>([...canalLeads.keys(), ...canalFat.keys()]);
  const canais = [...canaisSet]
    .map((o) => ({
      origin: o,
      label: originLabel[o as keyof typeof originLabel] ?? o,
      color: originColor(o),
      leads: canalLeads.get(o) ?? 0,
      fat: canalFat.get(o)?.fat ?? 0,
      pedidos: canalFat.get(o)?.pedidos ?? 0,
    }))
    .sort((a, b) => b.fat - a.fat || b.leads - a.leads);

  // ---- agregação por CAMPANHA ----
  const campLeads = new Map<string, number>();
  let leadsSemCamp = 0;
  for (const l of leads) {
    if (l.campaignId) campLeads.set(l.campaignId, (campLeads.get(l.campaignId) ?? 0) + 1);
    else leadsSemCamp += 1;
  }
  const campFat = new Map<string, { fat: number; pedidos: number; clientes: Set<string> }>();
  let fatSemCamp = 0;
  for (const o of paidOrders) {
    const cid = o.customer.campaignId;
    if (!cid) {
      fatSemCamp += o.total;
      continue;
    }
    const cur = campFat.get(cid) ?? { fat: 0, pedidos: 0, clientes: new Set<string>() };
    cur.fat += o.total;
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
        conversao: ld > 0 ? pct(clientes, ld) : null,
      };
    })
    .sort((a, b) => b.fat - a.fat || b.leads - a.leads);

  // ---- números do topo ----
  const totalLeads = leads.length;
  const totalFat = paidOrders.reduce((s, o) => s + o.total, 0);
  const ticket = paidOrders.length > 0 ? totalFat / paidOrders.length : 0;
  const prevLeads = prevLeadsCount;
  const prevRevenue = prevFat._sum.total ?? 0;
  const pctDelta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : null);
  const totalBuyers = buyerCounts.length;
  const repeatBuyers = buyerCounts.filter((b) => b._count._all >= 2).length;
  const recompra = totalBuyers > 0 ? Math.round((repeatBuyers / totalBuyers) * 100) : 0;

  const donutData = canais.filter((c) => c.fat > 0).slice(0, 6).map((c) => ({ label: c.label, value: c.fat, color: c.color }));
  const leadsBar = canais.filter((c) => c.leads > 0).slice(0, 6).map((c) => ({ label: c.label, value: c.leads, sub: `${pct(c.leads, totalLeads)}%` }));

  const campanhas: Campanha[] = campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    utmKey: c.utmKey,
    active: c.active,
    leads: c._count.customers,
  }));

  const semDados = totalLeads === 0 && totalFat === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Marketing"
        subtitle="De onde vêm seus clientes que compram — por canal e por campanha. Os números crescem conforme os vendedores marcam a campanha de cada lead."
      />

      <PeriodChips pathname="/marketing" de={de} ate={ate} />

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
      ) : (
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
      )}

      {/* ranking por campanha */}
      {(porCampanha.length > 0 || leadsSemCamp > 0 || fatSemCamp > 0) && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Resultado por campanha</h3>
          <div className="overflow-x-auto">
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
        <CampaignsManager initial={campanhas} />
      </div>
    </div>
  );
}
