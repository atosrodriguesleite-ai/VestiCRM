import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Brain,
  Eye,
  Users,
  Timer,
  Percent,
  ShoppingBag,
  Wallet,
  Repeat,
  AlertTriangle,
  Download,
  Bell,
  Filter,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { brl } from "@/lib/format";
import {
  periodFromDays,
  previousPeriod,
  overview,
  funnel,
  channelRanking,
  sellerRanking,
  campaignRanking,
  productStats,
  categoryStats,
  colorStats,
  sizeStats,
  heatmaps,
  recovery,
  alerts,
} from "@/lib/tracking/insights";
import { Card, PageHeader, Avatar, Badge, EmptyState } from "@/components/ui";
import { FunnelBars } from "@/components/charts";
import { LinksManager } from "./links-manager";
import { RecoveryList } from "./recovery-list";

export const dynamic = "force-dynamic";

const PERIODS = [
  { d: 1, label: "Hoje" },
  { d: 7, label: "7 dias" },
  { d: 30, label: "30 dias" },
  { d: 90, label: "90 dias" },
  { d: 365, label: "1 ano" },
];

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", google: "Google",
  "google-meu-negocio": "Google Meu Negócio", whatsapp: "WhatsApp",
  qr: "QR Code", direto: "Link Direto", indicacao: "Indicação",
  site: "Site", "loja-fisica": "Loja Física", marketplace: "Marketplace",
  campanha: "Campanhas", vendedor: "Link de Vendedor", tiktok: "TikTok",
};
const channelName = (c: string) => CHANNEL_LABEL[c] ?? c;

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (before === 0) return null;
  const diff = ((now - before) / before) * 100;
  if (!isFinite(diff) || Math.abs(diff) < 1) return null;
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={`text-[10px] font-bold ${good ? "text-emerald-600" : "text-rose-500"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(0)}%
    </span>
  );
}

function Kpi({ label, value, hint, delta, icon }: {
  label: string; value: string; hint?: string; delta?: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 bg-white rounded-2xl border border-slate-200/70 shadow-card p-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[10px] md:text-[11px] font-semibold text-slate-400 uppercase tracking-wider leading-tight">{label}</p>
        <span className="text-slate-300 shrink-0 [&>svg]:size-4">{icon}</span>
      </div>
      <p className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-lg sm:text-xl font-semibold tracking-tight tabular-nums text-slate-900 truncate max-w-full">
          {value}
        </span>
        {delta}
      </p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{hint}</p>}
    </div>
  );
}

function RankTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
            {headers.map((h, i) => (
              <th key={h} className={`py-2 pr-3 font-semibold ${i > 0 ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`py-2 pr-3 ${j > 0 ? "text-right tabular-nums text-gray-600" : "font-medium"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Heatmap({ grid, title, format }: { grid: number[][]; title: string; format?: (v: number) => string }) {
  const max = Math.max(...grid.flat(), 1);
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>
      <div className="overflow-x-auto thin-scroll">
        <div className="min-w-[540px]">
          {grid.map((row, d) => (
            <div key={d} className="flex items-center gap-[3px] mb-[3px]">
              <span className="w-8 text-[9px] text-gray-400 shrink-0">{DAY_LABELS[d]}</span>
              {row.map((v, h) => (
                <div
                  key={h}
                  title={`${DAY_LABELS[d]} ${h}h — ${format ? format(v) : v}`}
                  className="flex-1 h-4 rounded-[3px] min-w-[14px]"
                  style={{
                    background: v === 0 ? "#f3f1f7" : `rgba(124, 58, 237, ${0.15 + 0.85 * (v / max)})`,
                  }}
                />
              ))}
            </div>
          ))}
          <div className="flex gap-[3px] ml-8 mt-1">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="flex-1 min-w-[14px] text-[8px] text-gray-300 text-center">
                {h % 6 === 0 ? `${h}h` : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const sp = await searchParams;
  const days = [1, 7, 30, 90, 365].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const period = periodFromDays(days);
  const prev = previousPeriod(period);
  const c = user.companyId;

  const [now, before, funil, canais, vendedores, campanhas, produtos, categorias, cores, tamanhos, mapas, recuperacao, avisos, company, team] =
    await Promise.all([
      overview(c, period), overview(c, prev), funnel(c, period),
      channelRanking(c, period), sellerRanking(c, period), campaignRanking(c, period),
      productStats(c, period), categoryStats(c, period), colorStats(c, period), sizeStats(c, period),
      heatmaps(c, period), recovery(c, period), alerts(c, period),
      db.company.findUnique({ where: { id: c } }),
      db.user.findMany({ where: { companyId: c, active: true, role: { not: "SUPERADMIN" } }, select: { id: true, name: true } }),
    ]);

  const topProdutos = [...produtos].sort((a, b) => b.views - a.views).slice(0, 7);
  const topCategorias = [...categorias].sort((a, b) => b.revenue - a.revenue || b.views - a.views).slice(0, 6);
  const topCores = [...cores].sort((a, b) => b.sold - a.sold || b.views - a.views).slice(0, 6);
  const topTamanhos = [...tamanhos].sort((a, b) => b.sold - a.sold || b.views - a.views).slice(0, 6);
  const exportar = (rel: string) => `/api/intelligence/export?relatorio=${rel}&dias=${days}`;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Inteligência Comercial"
        subtitle="O cérebro comercial da loja: de onde vêm as vendas, o que chama atenção e quem está quase comprando."
        action={
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <Link
                key={p.d}
                href={`/inteligencia?dias=${p.d}`}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition ${
                  days === p.d
                    ? "bg-brand-600 text-white"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        }
      />

      {/* Alertas inteligentes */}
      {avisos.length > 0 && (
        <Card className="p-4 mb-5 border-amber-200 bg-amber-50/60">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Bell className="size-3.5" />
            Alertas inteligentes
          </p>
          <ul className="grid md:grid-cols-2 gap-x-6 gap-y-1">
            {avisos.map((a) => (
              <li key={a} className="text-sm text-amber-900 flex gap-2">
                <span className="text-amber-400">•</span> {a}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* KPIs vs período anterior */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Kpi label="Visitantes" value={String(now.visitors)} delta={<Delta now={now.visitors} before={before.visitors} />} icon={<Users />} />
        <Kpi label="Sessões" value={String(now.sessions)} delta={<Delta now={now.sessions} before={before.sessions} />} icon={<Eye />} />
        <Kpi label="Tempo médio" value={`${Math.floor(now.avgSessionSeconds / 60)}m${String(now.avgSessionSeconds % 60).padStart(2, "0")}s`} icon={<Timer />} />
        <Kpi label="Conversão" value={`${now.conversionRate.toFixed(1)}%`} delta={<Delta now={now.conversionRate} before={before.conversionRate} />} icon={<Percent />} />
        <Kpi label="Pedidos (catálogo)" value={String(now.ordersFromCatalog)} delta={<Delta now={now.ordersFromCatalog} before={before.ordersFromCatalog} />} icon={<ShoppingBag />} />
        <Kpi label="Faturamento" value={brl(now.revenue)} delta={<Delta now={now.revenue} before={before.revenue} />} icon={<Wallet />} />
        <Kpi label="Ticket médio" value={brl(now.avgTicket)} delta={<Delta now={now.avgTicket} before={before.avgTicket} />} />
        <Kpi label="Clientes novos" value={String(now.newCustomers)} delta={<Delta now={now.newCustomers} before={before.newCustomers} />} />
        <Kpi label="Recorrentes" value={String(now.returningBuyers)} icon={<Repeat />} />
        <Kpi label="Carrinhos abandonados" value={String(now.abandonedCarts)} hint={`${brl(now.abandonedValue)} parados`} delta={<Delta now={now.abandonedCarts} before={before.abandonedCarts} invert />} icon={<AlertTriangle />} />
        <Kpi label="Tempo de sessão total" value={`${Math.round((now.avgSessionSeconds * now.sessions) / 60)} min`} hint="navegação somada" />
        <Kpi label="Identificados" value={String(now.identifiedCustomers)} hint="visitantes que viraram clientes" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        {/* Funil comercial */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Filter className="size-4 text-brand-600" />
            Funil comercial
          </h2>
          <FunnelBars data={funil} />
        </Card>

        {/* Ranking de canais */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Ranking de canais</h2>
            <a href={exportar("canais")} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Download className="size-3.5" /> CSV
            </a>
          </div>
          {canais.length === 0 ? (
            <EmptyState title="Sem acessos no período" hint="Compartilhe os links inteligentes abaixo." />
          ) : (
            <RankTable
              headers={["Canal", "Acessos", "Pedidos", "Conv.", "Faturamento"]}
              rows={canais.map((r) => [
                channelName(r.channel), String(r.sessions), String(r.orders),
                `${r.conversion.toFixed(0)}%`, brl(r.revenue),
              ])}
            />
          )}
        </Card>

        {/* Ranking de vendedores */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Ranking dos vendedores</h2>
            <a href={exportar("vendedores")} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Download className="size-3.5" /> CSV
            </a>
          </div>
          {vendedores.length === 0 ? (
            <EmptyState title="Sem dados de vendedores" />
          ) : (
            <RankTable
              headers={["Vendedor", "Cliques", "Pedidos", "Conv.", "Faturamento", "Ticket"]}
              rows={vendedores.map((v) => [
                <span key={v.id} className="flex items-center gap-2">
                  <Avatar name={v.name} color={v.color} size="sm" />
                  {v.name.split(" ")[0]}
                </span>,
                String(v.clicks), String(v.orders), `${v.conversion.toFixed(0)}%`,
                brl(v.revenue), brl(v.avgTicket),
              ])}
            />
          )}
        </Card>

        {/* Campanhas */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Campanhas e QR Codes</h2>
            <a href={exportar("campanhas")} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Download className="size-3.5" /> CSV
            </a>
          </div>
          {campanhas.length === 0 ? (
            <EmptyState title="Nenhuma campanha ainda" hint="Crie links e QR Codes na seção abaixo." />
          ) : (
            <RankTable
              headers={["Campanha", "Cliques", "Pedidos", "Conv.", "Faturamento", "Meta"]}
              rows={campanhas.map((r) => [
                <span key={r.id}>
                  {r.name}{" "}
                  <span className="text-[10px] text-gray-400 font-mono">?ref={r.slug}</span>
                </span>,
                String(r.clicks), String(r.orders), `${r.conversion.toFixed(0)}%`,
                brl(r.revenue),
                r.goal > 0 ? `${(r.roi ?? 0).toFixed(0)}%` : "—",
              ])}
            />
          )}
        </Card>
      </div>

      {/* Produtos / categorias / cores / tamanhos */}
      <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Produtos — atenção × venda</h2>
            <a href={exportar("produtos")} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Download className="size-3.5" /> CSV
            </a>
          </div>
          {topProdutos.length === 0 ? (
            <EmptyState title="Sem navegação registrada" />
          ) : (
            <RankTable
              headers={["Produto", "Vistos", "+Sacola", "Removidos", "Vendidos", "Conv."]}
              rows={topProdutos.map((r) => [
                r.key, String(r.views), String(r.adds), String(r.removes), String(r.sold),
                <Badge key="c" color={r.conversion >= 20 ? "#059669" : r.conversion > 0 ? "#d97706" : "#94a3b8"}>
                  {r.conversion.toFixed(0)}%
                </Badge>,
              ])}
            />
          )}
        </Card>
        <div className="grid gap-4 md:gap-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">Categorias</h2>
              <a href={exportar("categorias")} className="text-xs font-medium text-brand-600"><Download className="size-3.5 inline" /> CSV</a>
            </div>
            <RankTable
              headers={["Categoria", "Acessos", "Vendidos", "Faturamento"]}
              rows={topCategorias.map((r) => [r.key, String(r.views), String(r.sold), brl(r.revenue)])}
            />
          </Card>
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm">Cores</h2>
                <a href={exportar("cores")} className="text-xs text-brand-600"><Download className="size-3.5 inline" /></a>
              </div>
              <RankTable
                headers={["Cor", "Vendidas"]}
                rows={topCores.map((r) => [r.key, `${r.sold} un.`])}
              />
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-sm">Tamanhos</h2>
                <a href={exportar("tamanhos")} className="text-xs text-brand-600"><Download className="size-3.5 inline" /></a>
              </div>
              <RankTable
                headers={["Tam.", "Vendidos"]}
                rows={topTamanhos.map((r) => [r.key, `${r.sold} un.`])}
              />
            </Card>
          </div>
        </div>
      </div>

      {/* Heatmaps */}
      <Card className="p-5 mb-6">
        <h2 className="font-semibold flex items-center gap-2 mb-4">
          <Brain className="size-4 text-brand-600" />
          Melhores horários (dia × hora)
        </h2>
        <div className="grid lg:grid-cols-2 gap-6">
          <Heatmap grid={mapas.access} title="Acessos ao catálogo" />
          <Heatmap grid={mapas.revenue} title="Vendas (R$)" format={(v) => brl(v)} />
        </div>
      </Card>

      {/* Recuperação comercial */}
      <h2 className="font-semibold mb-3">Recuperação comercial</h2>
      <RecoveryList items={recuperacao} />

      {/* Links inteligentes + QR */}
      <h2 className="font-semibold mt-8 mb-3">Links inteligentes e QR Codes</h2>
      <LinksManager
        slug={company?.slug ?? ""}
        catalogDomain={process.env.CATALOG_DOMAIN?.trim() ?? null}
        team={team}
        campaigns={campanhas.map((r) => ({
          id: r.id, name: r.name, slug: r.slug, channel: r.channel,
          clicks: r.clicks, orders: r.orders, revenue: r.revenue, active: r.active,
        }))}
      />
    </div>
  );
}
