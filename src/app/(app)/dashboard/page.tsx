import Link from "next/link";
import {
  Wallet,
  Users,
  Target,
  TrendingUp,
  Percent,
  AlertTriangle,
  CalendarClock,
  Trophy,
  Shirt,
  Zap,
  ChevronRight,
  ShoppingBag,
  Repeat,
  Package,
  Gem,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { maybeSyncNuvemshop } from "@/lib/nuvemshop";
import { db } from "@/lib/db";
import { ownedScope, taskScope, canSeeAll, isSuperAdmin } from "@/lib/scope";
import { computeAutomations } from "@/lib/automations";
import {
  brl,
  daysSince,
  dateShort,
  timeShort,
  taskTypeLabel,
  relativeDays,
} from "@/lib/format";
import {
  PAID_ORDER_STATUSES,
  ORDER_STATUS_FLOW,
  orderStatusLabel,
  orderStatusColor,
} from "@/lib/orders";
import { Card, PageHeader, Avatar, PriorityDot, EmptyState } from "@/components/ui";
import { BarList, AreaCompare, Donut, PeriodChips } from "@/components/charts";
import { StatCard } from "@/components/dash";
import { InfoTip } from "@/components/info-tip";
import { PrimeirosPassos, type Passo } from "./primeiros-passos";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  // loja integrada: busca carrinhos abandonados da Nuvemshop em 2º plano
  maybeSyncNuvemshop(user.companyId);
  const { de, ate } = await searchParams;
  // Super Admin (fora do modo "Acessar loja") gerencia a plataforma, não uma
  // loja: seu ponto de partida é a gestão de clientes (Lojas).
  if (isSuperAdmin(user) && !user.impersonatedBy) redirect("/lojas");
  // Suporte trabalha em Pedidos — dashboard comercial não é dele
  if (user.role === "SUPPORT") redirect("/pedidos");
  const scope = ownedScope(user);
  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // Período analítico do dashboard (filtro De/Até). Padrão: últimos 30 dias.
  const SP_OFFSET = 3 * 60 * 60 * 1000; // São Paulo é UTC-3
  const spStart = (d?: string) => {
    const t = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
    return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
  };
  const spEnd = (d?: string) => {
    const t = d ? Date.parse(`${d}T23:59:59.999Z`) : NaN;
    return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
  };
  const from = spStart(de) ?? days30;
  const to = spEnd(ate) ?? now;
  const inPeriod = { gte: from, lte: to };
  const customPeriod = !!(spStart(de) || spEnd(ate));
  // Período ANTERIOR com a mesma duração, imediatamente antes do atual —
  // base das setinhas de variação (% vs período anterior) nos cartões.
  const durMs = Math.max(to.getTime() - from.getTime(), 1);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - durMs);
  const inPrev = { gte: prevFrom, lte: prevTo };
  // meia-noite no fuso de São Paulo (UTC-3): o servidor roda em UTC e o
  // setHours local começaria o "hoje" 3h mais cedo
  const spMidnight = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  spMidnight.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(spMidnight.getTime() + 3 * 60 * 60 * 1000);
  const spMonth = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  spMonth.setUTCDate(1);
  spMonth.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(spMonth.getTime() + 3 * 60 * 60 * 1000);

  const saleScope = canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
  // Faturamento/venda = pedido PAGO (ou além). Pedido gerado sem pagamento
  // não conta como venda — regra central do produto.
  const orderScope = { ...saleScope, status: { in: PAID_ORDER_STATUSES } };
  // pedidos gerados (qualquer status) — denominador da conversão em pagamento
  const orderAnyScope = saleScope;

  // Todas as consultas independentes vão juntas ao banco (uma rodada só) —
  // é o que deixa o dashboard rápido de abrir.
  const [
    sales30,
    totalCustomers,
    newLeads30,
    openOpps,
    negotiatingOpps,
    lostOpps30,
    wonOpps30,
    closedOpps30,
    noContactCustomers,
    nextTasks,
    sellers,
    interests,
    suggestions,
    ordersToday,
    ordersWeek,
    ordersMonth,
    topItems,
    topBuyers,
    buyersAll,
    ordersGenerated30,
    monthOrders,
    companyCfg,
    prevSales,
    prevLeads,
    prevOrdersGenerated,
    statusCounts,
  ] = await Promise.all([
    // Faturamento = pedidos PAGOS (fonte única da verdade, igual à tela Pedidos)
    db.order.findMany({
      where: { ...orderScope, paidAt: inPeriod },
      select: { total: true, sellerId: true, paidAt: true },
    }),
    db.customer.count({ where: scope }),
    db.customer.count({ where: { ...scope, createdAt: inPeriod } }),
    db.opportunity.findMany({ where: { ...scope, status: "OPEN" } }),
    db.opportunity.count({
      where: {
        ...scope,
        status: "OPEN",
        stage: { name: { in: ["Pedido em negociação", "Pagamento pendente"] } },
      },
    }),
    db.opportunity.count({
      where: { ...scope, status: "LOST", closedAt: inPeriod },
    }),
    db.opportunity.count({
      where: { ...scope, status: "WON", closedAt: inPeriod },
    }),
    db.opportunity.count({
      where: {
        ...scope,
        status: { in: ["WON", "LOST"] },
        closedAt: inPeriod,
      },
    }),
    db.customer.findMany({
      where: {
        ...scope,
        OR: [{ lastContactAt: { lt: days7 } }, { lastContactAt: null }],
      },
      orderBy: { lastContactAt: "asc" },
      take: 6,
      include: { owner: true },
    }),
    db.task.findMany({
      where: { ...taskScope(user), status: "PENDENTE" },
      orderBy: { dueAt: "asc" },
      take: 7,
      include: { customer: true, assignee: true },
    }),
    db.user.findMany({
      where: { companyId: user.companyId, role: { in: ["SELLER", "MANAGER", "ADMIN"] } },
    }),
    db.interest.findMany({
      where: { companyId: user.companyId },
      include: { _count: { select: { customers: true } } },
    }),
    computeAutomations(user),
    // --- Pedidos (módulo catálogo) ---
    db.order.aggregate({
      where: { ...orderScope, paidAt: { gte: startOfDay } },
      _count: true,
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { ...orderScope, paidAt: { gte: days7 } },
      _count: true,
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { ...orderScope, paidAt: inPeriod },
      _count: true,
      _sum: { total: true },
    }),
    db.orderItem.groupBy({
      by: ["name"],
      where: { order: { ...orderScope, paidAt: inPeriod } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 6,
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: { ...orderScope, paidAt: inPeriod },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: "desc" } },
      take: 5,
    }),
    // taxa de recompra: clientes com 2+ pedidos entre quem já pediu
    db.order.groupBy({
      by: ["customerId"],
      where: orderScope,
      _count: true,
    }),
    db.order.count({ where: { ...orderAnyScope, createdAt: inPeriod } }),
    // metas: vendas pagas do MÊS CORRENTE (fuso SP), por vendedor
    db.order.findMany({
      where: {
        companyId: user.companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: startOfMonth },
      },
      select: { total: true, sellerId: true },
    }),
    // alerta de estoque: variações no limite configurado pela loja
    db.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { lowStockThreshold: true },
    }),
    // --- comparativo: mesmas métricas no período ANTERIOR ---
    db.order.findMany({
      where: { ...orderScope, paidAt: inPrev },
      select: { total: true, paidAt: true },
    }),
    db.customer.count({ where: { ...scope, createdAt: inPrev } }),
    db.order.count({ where: { ...orderAnyScope, createdAt: inPrev } }),
    // donut: composição dos pedidos do período por status (qualquer status)
    db.order.groupBy({
      by: ["status"],
      where: { ...orderAnyScope, createdAt: inPeriod },
      _count: true,
    }),
  ]);

  const buyerNames = await db.customer.findMany({
    where: { id: { in: topBuyers.map((b) => b.customerId) } },
    select: { id: true, name: true },
  });
  const buyerName = new Map(buyerNames.map((b) => [b.id, b.name]));
  const avgOrder = ordersMonth._count
    ? (ordersMonth._sum.total ?? 0) / ordersMonth._count
    : 0;
  const repurchaseRate = buyersAll.length
    ? (buyersAll.filter((b) => b._count >= 2).length / buyersAll.length) * 100
    : 0;

  const revenue30 = sales30.reduce((s, v) => s + v.total, 0);
  const ticket = sales30.length ? revenue30 / sales30.length : 0;
  // Conversão = pedidos que viraram pagamento ÷ pedidos gerados no período
  const ordersPaid30 = ordersMonth._count;
  const conversion = ordersGenerated30
    ? (ordersPaid30 / ordersGenerated30) * 100
    : 0;
  const pipelineValue = openOpps.reduce((s, o) => s + o.value, 0);
  const periodLabel = customPeriod
    ? `${dateShort(from)} a ${dateShort(to)}`
    : "últimos 30 dias";

  // --- séries diárias (fuso SP) + variação % vs período anterior ---
  const DAY = 86_400_000;
  const dayIdx = (d: Date) => Math.floor((d.getTime() - SP_OFFSET) / DAY);
  const firstIdx = dayIdx(from);
  const nDias = Math.min(Math.max(dayIdx(to) - firstIdx + 1, 1), 400);
  const serieFat = new Array<number>(nDias).fill(0);
  const seriePed = new Array<number>(nDias).fill(0);
  for (const v of sales30) {
    if (!v.paidAt) continue;
    const i = dayIdx(v.paidAt) - firstIdx;
    if (i >= 0 && i < nDias) {
      serieFat[i] += v.total;
      seriePed[i] += 1;
    }
  }
  const prevFirstIdx = dayIdx(prevFrom);
  const seriePrev = new Array<number>(nDias).fill(0);
  for (const v of prevSales) {
    if (!v.paidAt) continue;
    const i = dayIdx(v.paidAt) - prevFirstIdx;
    if (i >= 0 && i < nDias) seriePrev[i] += v.total;
  }
  let labelsDias = Array.from({ length: nDias }, (_, i) => {
    const d = new Date((firstIdx + i) * DAY);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  // período muito longo: agrupa por semana pro gráfico não virar serrote
  const porSemana = (arr: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < arr.length; i += 7)
      out.push(arr.slice(i, i + 7).reduce((a, b) => a + b, 0));
    return out;
  };
  let chartFat = serieFat;
  let chartPrev = seriePrev;
  if (nDias > 92) {
    chartFat = porSemana(serieFat);
    chartPrev = porSemana(seriePrev);
    labelsDias = labelsDias.filter((_, i) => i % 7 === 0);
  }

  const pctDelta = (cur: number, prev: number) =>
    prev > 0 ? ((cur - prev) / prev) * 100 : null;
  const prevRevenue = prevSales.reduce((s, v) => s + v.total, 0);
  const prevTicket = prevSales.length ? prevRevenue / prevSales.length : 0;
  const prevConversion = prevOrdersGenerated
    ? (prevSales.length / prevOrdersGenerated) * 100
    : 0;
  const deltaVendas = pctDelta(revenue30, prevRevenue);
  const deltaTicket = pctDelta(ticket, prevTicket);
  const deltaConv = pctDelta(conversion, prevConversion);
  const deltaPedidos = pctDelta(sales30.length, prevSales.length);
  const deltaLeads = pctDelta(newLeads30, prevLeads);

  // donut de status: na ordem do fluxo do pedido, com as cores oficiais
  const statusCount = new Map(statusCounts.map((s) => [s.status, s._count]));
  const donutStatus = ORDER_STATUS_FLOW.map((st) => ({
    label: orderStatusLabel[st],
    value: statusCount.get(st) ?? 0,
    color: orderStatusColor[st],
  }));
  const totalPedidosPeriodo = statusCounts.reduce((a, s) => a + s._count, 0);

  // ranking por vendedor (30 dias) — só gerente/admin vê o time todo
  const allSales30 = canSeeAll(user)
    ? sales30
    : await db.order.findMany({
        where: {
          companyId: user.companyId,
          status: { in: PAID_ORDER_STATUSES },
          paidAt: inPeriod,
        },
        select: { total: true, sellerId: true },
      });
  const ranking = sellers
    .map((s) => ({
      seller: s,
      total: allSales30
        .filter((v) => v.sellerId === s.id)
        .reduce((sum, v) => sum + v.total, 0),
      count: allSales30.filter((v) => v.sellerId === s.id).length,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.total - a.total);

  const topInterests = interests
    .map((i) => ({ label: i.name, value: i._count.customers }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // conta TODAS as pendentes vencidas (antes contava só entre as 7 exibidas
  // na lista — o cartão travava em "7" mesmo com 20 atrasadas)
  const overdue = await db.task.count({
    where: { ...taskScope(user), status: "PENDENTE", dueAt: { lt: now } },
  });

  // metas: vendido no mês por vendedor + meta própria (quando vendedor)
  const soldBySeller = new Map<string, number>();
  for (const o of monthOrders) {
    if (o.sellerId) soldBySeller.set(o.sellerId, (soldBySeller.get(o.sellerId) ?? 0) + o.total);
  }
  const me = sellers.find((s) => s.id === user.id);
  const myGoal = me?.monthlyGoal ?? 0;
  const mySold = soldBySeller.get(user.id) ?? 0;

  const lowStockCount = await db.productVariant.count({
    where: {
      product: { companyId: user.companyId, active: true },
      stock: { lte: companyCfg.lowStockThreshold },
    },
  });

  // Checklist "Primeiros passos" — só para quem configura a loja (a vendedora
  // não mexe em catálogo nem em conexão de WhatsApp). Lista vazia = card não
  // aparece; loja que completou os 4 passos também deixa de ver.
  let passos: Passo[] = [];
  if (canSeeAll(user)) {
    const [comm, produtosCount, pedidosCount, identidade] = await Promise.all([
      db.commSettings.findUnique({
        where: { companyId: user.companyId },
        select: { evolutionStatus: true },
      }),
      db.product.count({ where: { companyId: user.companyId } }),
      db.order.count({ where: { companyId: user.companyId } }),
      db.company.findUnique({
        where: { id: user.companyId },
        select: { logoUrl: true },
      }),
    ]);
    passos = [
      {
        done: comm?.evolutionStatus === "CONECTADO",
        label: "Conectar o WhatsApp da loja",
        hint: "É por onde a maior parte das vendas acontece.",
        href: "/comunicacao",
      },
      {
        done: produtosCount > 0,
        label: "Cadastrar o primeiro produto",
        hint: "Sem produto, o catálogo fica vazio.",
        href: "/produtos",
      },
      {
        done: Boolean(identidade?.logoUrl),
        label: "Colocar sua logo no catálogo",
        hint: "O catálogo passa a ter a cara da sua marca.",
        href: "/configuracoes/catalogo",
      },
      {
        done: pedidosCount > 0,
        label: "Receber o primeiro pedido",
        hint: "Compartilhe o link do catálogo com suas clientes.",
        href: "/configuracoes/catalogo",
      },
    ];
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title={`Olá, ${user.name.split(" ")[0]} 👋`}
        subtitle={`Visão geral do comercial — ${periodLabel}.`}
        action={
          <form className="flex flex-wrap items-end gap-2" method="GET">
            <div className="flex-1 min-w-0 sm:flex-none">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
              <input type="date" name="de" defaultValue={de ?? ""} className="w-full sm:w-auto rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
            </div>
            <div className="flex-1 min-w-0 sm:flex-none">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
              <input type="date" name="ate" defaultValue={ate ?? ""} className="w-full sm:w-auto rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
            </div>
            <button className="shrink-0 rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition">
              Filtrar
            </button>
            {customPeriod && (
              <Link href="/dashboard" className="text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-2.5">
                Limpar
              </Link>
            )}
          </form>
        }
      />

      <div className="mb-5 -mt-1">
        <PeriodChips pathname="/dashboard" de={de} ate={ate} />
      </div>

      <PrimeirosPassos passos={passos} />

      {suggestions.length > 0 && (
        <Link
          href="/automacoes"
          className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 mb-6 hover:bg-brand-100 transition group"
        >
          <Zap className="size-5 text-brand-600 shrink-0" />
          <p className="text-sm text-brand-800 flex-1">
            <span className="font-semibold">
              {suggestions.length}{" "}
              {suggestions.length === 1 ? "sugestão" : "sugestões"} de automação
            </span>{" "}
            — follow-ups, recompras e reativações esperando ação.
          </p>
          <ChevronRight className="size-4 text-brand-400 group-hover:translate-x-0.5 transition" />
        </Link>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard
          label={customPeriod ? "Vendas (período)" : "Vendas (30d)"}
          value={revenue30}
          format="brl"
          delta={deltaVendas}
          series={chartFat}
          hint={`${sales30.length} pedidos${customPeriod ? " no período" : ""}`}
          icon={<Wallet />}
          info="Soma do valor de todos os pedidos PAGOS no período. Pedido gerado sem pagamento não entra aqui. A setinha compara com o período anterior de mesma duração."
        />
        <StatCard
          label="Ticket médio"
          value={ticket}
          format="brl"
          delta={deltaTicket}
          icon={<TrendingUp />}
          info="Valor médio por pedido pago: total vendido ÷ número de pedidos pagos no período. A setinha compara com o período anterior."
        />
        <StatCard
          label="Taxa de conversão"
          value={conversion}
          format="pct"
          delta={deltaConv}
          hint={`${ordersPaid30} pagos · ${ordersGenerated30 - ordersPaid30} sem pagamento`}
          icon={<Percent />}
          tone={conversion >= 50 ? "good" : "warn"}
          info="De cada pedido criado, quantos foram pagos. Cálculo: pedidos pagos ÷ total de pedidos gerados no período."
        />
        <StatCard
          label="Funil aberto"
          value={pipelineValue}
          format="brl"
          hint={`${openOpps.length} oportunidades · ${negotiatingOpps} em fechamento`}
          icon={<Target />}
          info="Soma do valor das oportunidades ainda abertas no funil. É potencial de venda, não é faturamento."
        />
        <StatCard
          label="Clientes"
          value={totalCustomers}
          hint={`+${newLeads30} novos leads${customPeriod ? " no período" : " em 30d"}`}
          delta={deltaLeads}
          deltaHint="novos leads vs. período anterior"
          icon={<Users />}
          info="Total de clientes cadastrados na loja. O rodapé mostra quantos entraram no período — é essa entrada de leads que a setinha compara com o período anterior."
        />
        <StatCard
          label={customPeriod ? "Vendas perdidas (período)" : "Vendas perdidas (30d)"}
          value={lostOpps30}
          icon={<AlertTriangle />}
          tone={lostOpps30 > 3 ? "bad" : "default"}
          info="Oportunidades movidas para uma etapa de perda no funil dentro do período."
        />
        <StatCard
          label="Sem contato há 7+ dias"
          value={noContactCustomers.length}
          hint="clientes esfriando"
          icon={<CalendarClock />}
          tone={noContactCustomers.length > 0 ? "warn" : "good"}
          info="Clientes sem nenhum contato registrado nos últimos 7 dias (ou que nunca foram contatados)."
        />
        <StatCard
          label="Follow-ups atrasados"
          value={overdue}
          icon={<AlertTriangle />}
          tone={overdue > 0 ? "bad" : "good"}
          info="Tarefas de acompanhamento cuja data de vencimento já passou e continuam pendentes."
        />
        {myGoal > 0 && (
          <StatCard
            label="Minha meta do mês"
            value={Math.round((mySold / myGoal) * 100)}
            format="pct"
            hint={`${brl(mySold)} de ${brl(myGoal)}`}
            icon={<Target />}
            tone={mySold >= myGoal ? "good" : "default"}
            info="Quanto das suas vendas pagas do mês corrente já cobre a meta definida em Equipe."
          />
        )}
      </div>

      {/* Faturamento diário × período anterior + composição por status */}
      {(sales30.length > 0 || prevSales.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
          <Card className="p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <h2 className="font-semibold flex items-center gap-2 text-sm">
                <TrendingUp className="size-4 text-brand-600" />
                Faturamento no período
                <InfoTip text="Valor dos pedidos pagos por dia. A linha tracejada clara é o período anterior de mesma duração — dia 1 alinha com dia 1." />
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-brand-600 rounded" />
                  período atual
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed border-[#dbba8b] rounded" />
                  anterior
                </span>
              </div>
            </div>
            <AreaCompare
              points={chartFat}
              prevPoints={chartPrev}
              labels={labelsDias}
              formatValue={brl}
            />
          </Card>
          {totalPedidosPeriodo > 0 && (
            <Card className="p-5">
              <h2 className="font-semibold flex items-center gap-2 text-sm mb-4">
                <ShoppingBag className="size-4 text-brand-600" />
                Status dos pedidos
                <InfoTip text="Todos os pedidos criados no período, separados por status atual. Ajuda a ver quantos estão parados aguardando pagamento ou em produção." />
              </h2>
              <Donut
                data={donutStatus}
                centerValue={String(totalPedidosPeriodo)}
                centerLabel="pedidos no período"
              />
            </Card>
          )}
        </div>
      )}

      {/* Pedidos (catálogo) */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm text-gray-600">
          <ShoppingBag className="size-4 text-brand-600" />
          Pedidos
        </h2>
        <Link
          href="/pedidos"
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Ver pedidos
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard
          label="Pedidos pagos hoje"
          value={ordersToday._count}
          hint={brl(ordersToday._sum.total ?? 0)}
          icon={<ShoppingBag />}
          info="Quantidade e valor dos pedidos pagos hoje (desde a meia-noite, horário de São Paulo)."
        />
        <StatCard
          label="Pagos na semana"
          value={ordersWeek._count}
          hint={brl(ordersWeek._sum.total ?? 0)}
          icon={<ShoppingBag />}
          info="Pedidos pagos nos últimos 7 dias, com o valor somado."
        />
        <StatCard
          label={customPeriod ? "Pagos no período" : "Pagos no mês"}
          value={ordersMonth._count}
          delta={deltaPedidos}
          series={seriePed.length > 92 ? porSemana(seriePed) : seriePed}
          hint={`valor médio ${brl(avgOrder)}`}
          icon={<ShoppingBag />}
          info="Pedidos pagos no período (padrão: últimos 30 dias). O rodapé mostra o valor médio por pedido; a setinha compara com o período anterior."
        />
        <StatCard
          label="Taxa de recompra"
          value={repurchaseRate}
          format="pct"
          hint="clientes com 2+ pedidos"
          icon={<Repeat />}
          tone={repurchaseRate >= 30 ? "good" : "warn"}
          info="De todos os clientes que já compraram, quantos fizeram 2 pedidos pagos ou mais."
        />
        <StatCard
          label="Estoque baixo"
          value={lowStockCount}
          hint={`variações com ≤ ${companyCfg.lowStockThreshold} peças`}
          icon={<Package />}
          tone={lowStockCount > 0 ? "warn" : "good"}
          info="Variações (cor/tamanho) de produtos ativos com estoque no limite definido pela loja. Veja a lista e ajuste o limite na tela Produtos."
        />
      </div>

      {(topItems.length > 0 || topBuyers.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Package className="size-4 text-brand-600" />
              Produtos mais vendidos
              <InfoTip text="Peças mais vendidas em pedidos PAGOS no período, somando a quantidade de cada modelo. Pedido cancelado ou sem pagamento não conta." />
            </h2>
            {topItems.length === 0 ? (
              <EmptyState title="Nenhum pedido ainda" />
            ) : (
              <BarList
                data={topItems.map((i) => ({
                  label: i.name,
                  value: i._sum.quantity ?? 0,
                }))}
                formatValue={(v) => `${v} un.`}
              />
            )}
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Gem className="size-4 text-emerald-600" />
              Clientes que mais compram
              <InfoTip text="Clientes que mais gastaram em pedidos PAGOS no período. Mostra o total gasto e quantos pedidos cada um fez." />
            </h2>
            {topBuyers.length === 0 ? (
              <EmptyState title="Nenhum pedido ainda" />
            ) : (
              <BarList
                color="#10b981"
                data={topBuyers.map((b) => ({
                  label: buyerName.get(b.customerId) ?? "Cliente",
                  value: b._sum.total ?? 0,
                  sub: `${b._count} pedido${b._count === 1 ? "" : "s"}`,
                }))}
                formatValue={brl}
              />
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Próximos follow-ups */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <CalendarClock className="size-4 text-brand-600" />
              Próximos follow-ups
            </h2>
            <Link
              href="/tarefas"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Ver todas
            </Link>
          </div>
          {nextTasks.length === 0 ? (
            <EmptyState title="Nenhuma tarefa pendente" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {nextTasks.map((t) => {
                const late = t.dueAt < now;
                return (
                  <li key={t.id} className="py-2.5 flex items-center gap-3">
                    <PriorityDot priority={t.priority} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {t.customer?.name} · {taskTypeLabel[t.type]}
                      </p>
                    </div>
                    {t.assignee && (
                      <Avatar
                        name={t.assignee.name}
                        color={t.assignee.color}
                        size="sm"
                      />
                    )}
                    <span
                      className={`text-xs tabular-nums shrink-0 ${late ? "text-rose-600 font-semibold" : "text-gray-500"}`}
                    >
                      {late ? "Atrasada · " : ""}
                      {dateShort(t.dueAt)} {timeShort(t.dueAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Ranking de vendedores */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Trophy className="size-4 text-amber-500" />
            Ranking de vendedores
            <InfoTip text="Vendedores ordenados pelo valor em pedidos PAGOS no período, com a quantidade de vendas de cada um. Baseado no vendedor atribuído ao pedido." />
          </h2>
          {ranking.length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <ul className="space-y-3">
              {ranking.map((r, i) => (
                <li key={r.seller.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-300 w-4">
                    {i + 1}º
                  </span>
                  <Avatar name={r.seller.name} color={r.seller.color} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {r.seller.name}
                    </p>
                    <p className="text-xs text-gray-400">{r.count} vendas</p>
                    {r.seller.monthlyGoal > 0 && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${(soldBySeller.get(r.seller.id) ?? 0) >= r.seller.monthlyGoal ? "bg-emerald-500" : "bg-brand-500"}`}
                            style={{ width: `${Math.min(100, ((soldBySeller.get(r.seller.id) ?? 0) / r.seller.monthlyGoal) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                          {Math.round(((soldBySeller.get(r.seller.id) ?? 0) / r.seller.monthlyGoal) * 100)}% da meta
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {brl(r.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Clientes esfriando */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Clientes sem contato
            </h2>
            <Link
              href="/clientes"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Ver clientes
            </Link>
          </div>
          {noContactCustomers.length === 0 ? (
            <EmptyState title="Todos os clientes com contato recente 🎉" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {noContactCustomers.map((c) => (
                <li key={c.id} className="py-2.5 flex items-center gap-3">
                  <Avatar name={c.name} color="#94a3b8" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/clientes/${c.id}`}
                      className="text-sm font-medium truncate hover:text-brand-600 block"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-gray-400">
                      {c.city ?? "—"} · {c.owner?.name ?? "sem responsável"}
                    </p>
                  </div>
                  <span className="text-xs text-amber-600 font-medium shrink-0">
                    {c.lastContactAt
                      ? `${daysSince(c.lastContactAt)} dias sem contato`
                      : "nunca contatado"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Interesses mais procurados */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Shirt className="size-4 text-brand-600" />
            Produtos mais procurados
          </h2>
          {topInterests.length === 0 ? (
            <EmptyState title="Sem interesses registrados" />
          ) : (
            <BarList
              data={topInterests}
              formatValue={(v) => `${v} cliente${v === 1 ? "" : "s"}`}
            />
          )}
        </Card>
      </div>

      {user.role === "SELLER" && (
        <p className="text-xs text-gray-400 mt-6">
          Você está vendo apenas os seus clientes e atendimentos.{" "}
          {relativeDays(now)}
        </p>
      )}
    </div>
  );
}
