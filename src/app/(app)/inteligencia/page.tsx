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
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import {
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
import { InfoTip } from "@/components/info-tip";
import { RecoveryList } from "./recovery-list";
import { lerPeriodo, paramsDoPeriodo, periodoPorExtenso } from "@/lib/periodo";

export const dynamic = "force-dynamic";

const PERIODS = [
  { d: 1, label: "Hoje" },
  { d: 7, label: "7 dias" },
  { d: 30, label: "30 dias" },
  { d: 90, label: "90 dias" },
  { d: 365, label: "1 ano" },
];

/** Quantas oportunidades de recuperação a tela mostra antes de "ver todas". */
const RECUPERACAO_NA_TELA = 12;

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", google: "Google",
  "google-meu-negocio": "Google Meu Negócio", whatsapp: "WhatsApp",
  qr: "QR Code", direto: "Link Direto", indicacao: "Indicação",
  site: "Site", "loja-fisica": "Loja Física", marketplace: "Marketplace",
  campanha: "Campanhas", vendedor: "Link de Vendedor", tiktok: "TikTok",
  bio: "Bio (página de links)",
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

function Kpi({ label, value, hint, delta, icon, info, href }: {
  label: string; value: string; hint?: string; delta?: React.ReactNode; icon?: React.ReactNode; info?: string;
  /** quando existe, o cartão inteiro vira link (ex.: carrinhos → lista) */
  href?: string;
}) {
  const Wrapper = (href ? Link : "div") as React.ElementType;
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={`block min-w-0 bg-white rounded-2xl border border-slate-200/70 shadow-card p-4${
        href ? " hover:border-brand-300 hover:shadow-pop transition" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-mono text-[10px] md:text-[11px] font-semibold text-slate-400 uppercase tracking-[0.1em] leading-tight flex items-center gap-1">
          {label}
          {info && <InfoTip text={info} />}
        </p>
        <span className="text-slate-300 shrink-0 [&>svg]:size-4">{icon}</span>
      </div>
      <p className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-lg sm:text-xl font-semibold tracking-tight tabular-nums text-slate-900 truncate max-w-full">
          {value}
        </span>
        {delta}
      </p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{hint}</p>}
    </Wrapper>
  );
}

function RankTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <>
      {/* Computador: tabela (inalterada) */}
      <div className="hidden md:block overflow-x-auto thin-scroll">
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

      {/* Celular: cada linha vira um cartão — cabe na tela, sem rolar pro lado */}
      <div className="md:hidden space-y-1.5">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">Sem dados no período.</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-gray-100 px-3 py-2.5">
              {r.length <= 2 ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium text-gray-800">{r[0]}</span>
                  {r[1] != null && <span className="shrink-0 text-sm tabular-nums text-gray-600">{r[1]}</span>}
                </div>
              ) : (
                <>
                  <div className="mb-1.5 text-sm font-medium text-gray-800">{r[0]}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {r.slice(1).map((cell, j) => (
                      <div key={j} className="text-xs">
                        <span className="text-gray-400">{headers[j + 1]} </span>
                        <span className="font-semibold tabular-nums text-gray-700">{cell}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Heatmap({ grid, title, format }: { grid: number[][]; title: string; format?: (v: number) => string }) {
  const max = Math.max(...grid.flat(), 1);
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>
      {/* no celular as células encolhem para caber (sem rolagem lateral);
          no computador mantém o tamanho confortável com rolagem se precisar */}
      <div className="md:overflow-x-auto thin-scroll">
        <div className="md:min-w-[540px]">
          {grid.map((row, d) => (
            <div key={d} className="flex items-center gap-[2px] md:gap-[3px] mb-[2px] md:mb-[3px]">
              <span className="w-6 md:w-8 text-[9px] text-gray-400 shrink-0">{DAY_LABELS[d]}</span>
              {row.map((v, h) => (
                <div
                  key={h}
                  title={`${DAY_LABELS[d]} ${h}h — ${format ? format(v) : v}`}
                  className="flex-1 h-4 rounded-[2px] md:rounded-[3px] min-w-0 md:min-w-[14px]"
                  style={{
                    background: v === 0 ? "#f3f1f7" : `rgba(124, 58, 237, ${0.15 + 0.85 * (v / max)})`,
                  }}
                />
              ))}
            </div>
          ))}
          <div className="flex gap-[2px] md:gap-[3px] ml-6 md:ml-8 mt-1">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="flex-1 min-w-0 md:min-w-[14px] text-[8px] text-gray-300 text-center">
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
  searchParams: Promise<{
    dias?: string;
    de?: string;
    ate?: string;
    recuperacao?: string;
  }>;
}) {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const sp = await searchParams;
  // atalho ("30 dias") OU datas escolhidas a dedo — a leitura é uma só
  const filtro = lerPeriodo(sp);
  const { period } = filtro;
  const days = filtro.dias;
  const prev = previousPeriod(period);
  // "ver todas" as oportunidades de recuperação (a lista nasce curta)
  const verTodaRecuperacao = sp.recuperacao === "tudo";
  const c = user.companyId;

  // Vendas por ORIGEM (pedidos pagos no período): separa o resultado do
  // catálogo/WhatsApp, da loja online (Nuvemshop) e dos pedidos manuais
  const porOrigemRaw = await db.order.groupBy({
    by: ["source"],
    where: {
      companyId: c,
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { gte: period.from, lte: period.to },
    },
    _sum: { netTotal: true },
    _count: true,
  });
  const ORIGEM_LABEL: Record<string, string> = {
    CATALOGO: "Catálogo + WhatsApp",
    NUVEMSHOP: "Loja online (Nuvemshop)",
    MANUAL: "Manual",
  };
  const porOrigem = porOrigemRaw
    .map((r) => ({
      origem: ORIGEM_LABEL[r.source] ?? r.source,
      pedidos: r._count,
      total: r._sum.netTotal ?? 0,
      isNuvemshop: r.source === "NUVEMSHOP",
    }))
    .sort((a, b) => b.total - a.total);
  // frete-ok: `r.total` aqui é um total local já montado a partir de netTotal
  // (linha acima) — não é o campo `total` do pedido
  const totalOrigens = porOrigem.reduce((a, r) => a + r.total, 0);

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
  const exportar = (rel: string) =>
    `/api/intelligence/export?relatorio=${rel}&${paramsDoPeriodo(filtro)}`;

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

      {/* PERÍODO PERSONALIZADO.
          Os atalhos resolvem o dia a dia, mas não a pergunta que a lojista
          faz de verdade: "quanto vendi na Black Friday?", "como fechou o mês
          passado?". Aqui ela escolhe o começo e o fim. */}
      <form method="GET" className="flex flex-wrap items-end gap-2 mb-5">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
          <input
            type="date"
            name="de"
            defaultValue={filtro.de ?? ""}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
          <input
            type="date"
            name="ate"
            defaultValue={filtro.ate ?? ""}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white"
          />
        </div>
        <button className="rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition">
          Filtrar
        </button>
        {filtro.personalizado && (
          <>
            <span className="text-xs font-medium text-brand-700 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2.5">
              Período: {periodoPorExtenso(filtro)}
            </span>
            <Link
              href="/inteligencia?dias=30"
              className="text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-2.5"
            >
              Limpar
            </Link>
          </>
        )}
      </form>

      {/* Alertas inteligentes */}
      {avisos.length > 0 && (
        <Card className="p-4 mb-5 border-amber-200 bg-amber-50/60">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Bell className="size-3.5" />
            Alertas inteligentes
            {/* os alertas são o AGORA — não seguem o filtro de período */}
            <span className="font-medium normal-case tracking-normal text-amber-500">
              · últimas 24h
            </span>
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
        <Kpi label="Visitantes" value={String(now.visitors)} delta={<Delta now={now.visitors} before={before.visitors} />} icon={<Users />} info="Pessoas diferentes que abriram o catálogo no período (contadas uma vez, mesmo que voltem)." />
        <Kpi label="Sessões" value={String(now.sessions)} delta={<Delta now={now.sessions} before={before.sessions} />} icon={<Eye />} info="Quantidade de visitas ao catálogo. A mesma pessoa pode gerar várias sessões se acessar em momentos diferentes." />
        <Kpi label="Tempo médio" value={`${Math.floor(now.avgSessionSeconds / 60)}m${String(now.avgSessionSeconds % 60).padStart(2, "0")}s`} icon={<Timer />} info="Tempo médio que cada visita durou no catálogo (soma do tempo de todas as sessões ÷ nº de sessões)." />
        <Kpi label="Conversão" value={`${now.conversionRate.toFixed(1)}%`} delta={<Delta now={now.conversionRate} before={before.conversionRate} />} icon={<Percent />} info="De cada 100 visitas, quantas enviaram um pedido pelo catálogo. Fórmula: pedidos ÷ sessões × 100." />
        <Kpi label="Pedidos (catálogo)" value={String(now.ordersFromCatalog)} delta={<Delta now={now.ordersFromCatalog} before={before.ordersFromCatalog} />} icon={<ShoppingBag />} info="Pedidos enviados pelo catálogo no período (visitantes que tocaram em Enviar pedido)." />
        {/* rótulo honesto: a conta é da LOJA INTEIRA (regra da casa), não só
            do catálogo — o texto antigo fazia loja com Nuvemshop forte achar
            que o catálogo tinha vendido tudo (auditoria 06/08/2026) */}
        <Kpi label="Faturamento" value={brl(now.revenue)} delta={<Delta now={now.revenue} before={before.revenue} />} icon={<Wallet />} info="Faturamento da LOJA INTEIRA no período: pedidos pagos (sem frete), de qualquer origem — catálogo, loja online e pedidos montados no sistema." />
        <Kpi label="Ticket médio" value={brl(now.avgTicket)} delta={<Delta now={now.avgTicket} before={before.avgTicket} />} info="Valor médio por pedido PAGO da loja inteira: faturamento ÷ nº de pedidos pagos (todas as origens, não só o catálogo)." />
        <Kpi label="Clientes novos" value={String(now.newCustomers)} delta={<Delta now={now.newCustomers} before={before.newCustomers} />} info="Clientes cadastrados pela primeira vez no período (primeiro contato com a loja)." />
        <Kpi label="Recorrentes" value={String(now.returningBuyers)} icon={<Repeat />} info="Clientes que compraram mais de uma vez (fidelizados)." />
        <Kpi label="Carrinhos abandonados" value={String(now.abandonedCarts)} hint={`${brl(now.abandonedValue)} parados`} delta={<Delta now={now.abandonedCarts} before={before.abandonedCarts} invert />} icon={<AlertTriangle />} info="Pessoas que deixaram sacola com itens sem enviar o pedido — cada pessoa conta UMA vez (a sacola mais recente dela), mesma régua da lista de recuperação. 'Parados' = valor somado dessas sacolas." href={`/inteligencia?${paramsDoPeriodo(filtro)}&recuperacao=tudo#recuperar`} />
        <Kpi label="Tempo de sessão total" value={`${Math.round(now.totalSessionSeconds / 60)} min`} hint="navegação somada" info="Soma REAL do tempo de navegação de todas as sessões no período." />
        <Kpi label="Identificados" value={String(now.identifiedCustomers)} hint="visitas com nome" info="Visitantes ligados a um cliente da base — pelo telefone informado OU por já terem chegado pelo link rastreado da cliente (?c=). Inclui quem já era cliente antes de visitar." />
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

        {/* Vendas por origem: catálogo × loja online × manual */}
        {porOrigem.length > 0 && (
          <Card className="p-5">
            <h2 className="font-semibold mb-1">Vendas por origem</h2>
            <p className="text-xs text-gray-400 mb-4">
              Pedidos pagos no período, separados por onde a venda nasceu.
            </p>
            <div className="space-y-3">
              {porOrigem.map((r) => (
                <div key={r.origem}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className={`text-sm font-semibold ${r.isNuvemshop ? "text-cyan-700" : ""}`}>
                      {r.origem}
                    </span>
                    <span className="text-sm tabular-nums">
                      <b>{brl(r.total)}</b>{" "}
                      <span className="text-xs text-gray-400">
                        · {r.pedidos} pedido{r.pedidos === 1 ? "" : "s"} ·{" "}
                        {totalOrigens > 0 ? Math.round((r.total / totalOrigens) * 100) : 0}%
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${totalOrigens > 0 ? Math.max(2, (r.total / totalOrigens) * 100) : 0}%`,
                        background: r.isNuvemshop ? "#0891B2" : "#C4622D",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

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
            // "Pedidos" = enviados pelo catálogo; "Faturamento (pago)" =
            // pedidos dessas visitas que VIRARAM dinheiro (netTotal pago)
            <RankTable
              headers={["Canal", "Acessos", "Pedidos", "Conv.", "Faturamento (pago)"]}
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
              headers={["Campanha", "Cliques", "Pedidos", "Conv.", "Faturamento (pago)", "Meta"]}
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

      {/* Recuperação comercial.
          O cartão lá em cima diz "33 carrinhos abandonados" e antes a lista
          mostrava no máximo 12 — os outros 21 eram dinheiro parado que a loja
          não tinha como perseguir. Agora dá para abrir a lista inteira. */}
      <div id="recuperar" className="flex items-center justify-between gap-3 mb-3 scroll-mt-20">
        <h2 className="font-semibold">
          Recuperação comercial
          {recuperacao.length > 0 && (
            <span className="text-gray-400 font-normal"> ({recuperacao.length})</span>
          )}
        </h2>
        {recuperacao.length > RECUPERACAO_NA_TELA && (
          <Link
            href={`/inteligencia?${paramsDoPeriodo(filtro)}${
              verTodaRecuperacao ? "" : "&recuperacao=tudo"
            }#recuperar`}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            {verTodaRecuperacao
              ? "Mostrar menos"
              : `Ver todas as ${recuperacao.length} oportunidades`}
          </Link>
        )}
      </div>
      <RecoveryList
        items={
          verTodaRecuperacao ? recuperacao : recuperacao.slice(0, RECUPERACAO_NA_TELA)
        }
      />

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
