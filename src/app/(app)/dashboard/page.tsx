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
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { Card, PageHeader, Avatar, PriorityDot, EmptyState } from "@/components/ui";
import { StatTile, BarList } from "@/components/charts";
import { InfoTip } from "@/components/info-tip";

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
  ] = await Promise.all([
    // Faturamento = pedidos PAGOS (fonte única da verdade, igual à tela Pedidos)
    db.order.findMany({
      where: { ...orderScope, createdAt: inPeriod },
      select: { total: true, sellerId: true },
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
      where: { ...orderScope, createdAt: { gte: startOfDay } },
      _count: true,
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { ...orderScope, createdAt: { gte: days7 } },
      _count: true,
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: { ...orderScope, createdAt: inPeriod },
      _count: true,
      _sum: { total: true },
    }),
    db.orderItem.groupBy({
      by: ["name"],
      where: { order: { ...orderScope, createdAt: inPeriod } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 6,
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: { ...orderScope, createdAt: inPeriod },
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
        createdAt: { gte: startOfMonth },
      },
      select: { total: true, sellerId: true },
    }),
    // alerta de estoque: variações no limite configurado pela loja
    db.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { lowStockThreshold: true },
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

  // ranking por vendedor (30 dias) — só gerente/admin vê o time todo
  const allSales30 = canSeeAll(user)
    ? sales30
    : await db.order.findMany({
        where: {
          companyId: user.companyId,
          status: { in: PAID_ORDER_STATUSES },
          createdAt: inPeriod,
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

  const overdue = nextTasks.filter((t) => t.dueAt < now).length;

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

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title={`Olá, ${user.name.split(" ")[0]} 👋`}
        subtitle={`Visão geral do comercial — ${periodLabel}.`}
        action={
          <form className="flex items-end gap-2" method="GET">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
              <input type="date" name="de" defaultValue={de ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
              <input type="date" name="ate" defaultValue={ate ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
            </div>
            <button className="rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition">
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
        <StatTile
          label={customPeriod ? "Vendas (período)" : "Vendas (30d)"}
          value={brl(revenue30)}
          hint={`${sales30.length} pedidos${customPeriod ? " no período" : ""}`}
          icon={<Wallet />}
          info="Soma do valor de todos os pedidos PAGOS no período. Pedido gerado sem pagamento não entra aqui."
        />
        <StatTile
          label="Ticket médio"
          value={brl(ticket)}
          icon={<TrendingUp />}
          info="Valor médio por pedido pago: total vendido ÷ número de pedidos pagos no período."
        />
        <StatTile
          label="Taxa de conversão"
          value={`${conversion.toFixed(0)}%`}
          hint={`${ordersPaid30} pagos · ${ordersGenerated30 - ordersPaid30} sem pagamento`}
          icon={<Percent />}
          tone={conversion >= 50 ? "good" : "warn"}
          info="De cada pedido criado, quantos foram pagos. Cálculo: pedidos pagos ÷ total de pedidos gerados no período."
        />
        <StatTile
          label="Funil aberto"
          value={brl(pipelineValue)}
          hint={`${openOpps.length} oportunidades · ${negotiatingOpps} em fechamento`}
          icon={<Target />}
          info="Soma do valor das oportunidades ainda abertas no funil. É potencial de venda, não é faturamento."
        />
        <StatTile
          label="Clientes"
          value={String(totalCustomers)}
          hint={`+${newLeads30} novos leads${customPeriod ? " no período" : " em 30d"}`}
          icon={<Users />}
          info="Total de clientes cadastrados na loja. O rodapé mostra quantos entraram no período."
        />
        <StatTile
          label={customPeriod ? "Vendas perdidas (período)" : "Vendas perdidas (30d)"}
          value={String(lostOpps30)}
          icon={<AlertTriangle />}
          tone={lostOpps30 > 3 ? "bad" : "default"}
          info="Oportunidades movidas para uma etapa de perda no funil dentro do período."
        />
        <StatTile
          label="Sem contato há 7+ dias"
          value={String(noContactCustomers.length)}
          hint="clientes esfriando"
          icon={<CalendarClock />}
          tone={noContactCustomers.length > 0 ? "warn" : "good"}
          info="Clientes sem nenhum contato registrado nos últimos 7 dias (ou que nunca foram contatados)."
        />
        <StatTile
          label="Follow-ups atrasados"
          value={String(overdue)}
          icon={<AlertTriangle />}
          tone={overdue > 0 ? "bad" : "good"}
          info="Tarefas de acompanhamento cuja data de vencimento já passou e continuam pendentes."
        />
        {myGoal > 0 && (
          <StatTile
            label="Minha meta do mês"
            value={`${Math.round((mySold / myGoal) * 100)}%`}
            hint={`${brl(mySold)} de ${brl(myGoal)}`}
            icon={<Target />}
            tone={mySold >= myGoal ? "good" : "default"}
            info="Quanto das suas vendas pagas do mês corrente já cobre a meta definida em Equipe."
          />
        )}
      </div>

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
        <StatTile
          label="Pedidos pagos hoje"
          value={String(ordersToday._count)}
          hint={brl(ordersToday._sum.total ?? 0)}
          icon={<ShoppingBag />}
          info="Quantidade e valor dos pedidos pagos hoje (desde a meia-noite, horário de São Paulo)."
        />
        <StatTile
          label="Pagos na semana"
          value={String(ordersWeek._count)}
          hint={brl(ordersWeek._sum.total ?? 0)}
          icon={<ShoppingBag />}
          info="Pedidos pagos nos últimos 7 dias, com o valor somado."
        />
        <StatTile
          label="Pagos no mês"
          value={String(ordersMonth._count)}
          hint={`valor médio ${brl(avgOrder)}`}
          icon={<ShoppingBag />}
          info="Pedidos pagos no período (padrão: últimos 30 dias). O rodapé mostra o valor médio por pedido."
        />
        <StatTile
          label="Taxa de recompra"
          value={`${repurchaseRate.toFixed(0)}%`}
          hint="clientes com 2+ pedidos"
          icon={<Repeat />}
          tone={repurchaseRate >= 30 ? "good" : "warn"}
          info="De todos os clientes que já compraram, quantos fizeram 2 pedidos pagos ou mais."
        />
        <StatTile
          label="Estoque baixo"
          value={String(lowStockCount)}
          hint={`variações com ≤ ${companyCfg.lowStockThreshold} peças`}
          icon={<Package />}
          tone={lowStockCount > 0 ? "warn" : "good"}
          info="Variações (cor/tamanho) de produtos ativos com estoque no limite definido pela loja. Veja a lista e ajuste o limite na tela Produtos."
        />
      </div>

      {(topItems.length > 0 || topBuyers.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-6">
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

      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
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
