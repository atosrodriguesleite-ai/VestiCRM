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

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  // Super Admin (fora do modo "Acessar loja") gerencia a plataforma, não uma
  // loja: seu ponto de partida é a gestão de clientes (Lojas).
  if (isSuperAdmin(user) && !user.impersonatedBy) redirect("/lojas");
  const scope = ownedScope(user);
  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // meia-noite no fuso de São Paulo (UTC-3): o servidor roda em UTC e o
  // setHours local começaria o "hoje" 3h mais cedo
  const spMidnight = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  spMidnight.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(spMidnight.getTime() + 3 * 60 * 60 * 1000);

  const saleScope = canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
  // Faturamento/venda = pedido PAGO (ou além). Pedido gerado sem pagamento
  // não conta como venda — regra central do produto.
  const orderScope = { ...saleScope, status: { in: PAID_ORDER_STATUSES } };
  // pedidos gerados (qualquer status) — denominador da conversão em pagamento
  const orderAnyScope = saleScope;

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
  ] = await Promise.all([
    db.sale.findMany({ where: { ...saleScope, createdAt: { gte: days30 } } }),
    db.customer.count({ where: scope }),
    db.customer.count({ where: { ...scope, createdAt: { gte: days30 } } }),
    db.opportunity.findMany({ where: { ...scope, status: "OPEN" } }),
    db.opportunity.count({
      where: {
        ...scope,
        status: "OPEN",
        stage: { name: { in: ["Pedido em negociação", "Pagamento pendente"] } },
      },
    }),
    db.opportunity.count({
      where: { ...scope, status: "LOST", closedAt: { gte: days30 } },
    }),
    db.opportunity.count({
      where: { ...scope, status: "WON", closedAt: { gte: days30 } },
    }),
    db.opportunity.count({
      where: {
        ...scope,
        status: { in: ["WON", "LOST"] },
        closedAt: { gte: days30 },
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
  ]);

  // --- Pedidos (módulo catálogo) ---
  const [ordersToday, ordersWeek, ordersMonth, topItems, topBuyers] =
    await Promise.all([
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
        where: { ...orderScope, createdAt: { gte: days30 } },
        _count: true,
        _sum: { total: true },
      }),
      db.orderItem.groupBy({
        by: ["name"],
        where: { order: orderScope },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 6,
      }),
      db.order.groupBy({
        by: ["customerId"],
        where: orderScope,
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: "desc" } },
        take: 5,
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
  // taxa de recompra: clientes com 2+ pedidos entre quem já pediu
  const buyersAll = await db.order.groupBy({
    by: ["customerId"],
    where: orderScope,
    _count: true,
  });
  const repurchaseRate = buyersAll.length
    ? (buyersAll.filter((b) => b._count >= 2).length / buyersAll.length) * 100
    : 0;

  const revenue30 = sales30.reduce((s, v) => s + v.total, 0);
  const ticket = sales30.length ? revenue30 / sales30.length : 0;
  // Conversão = pedidos que viraram pagamento ÷ pedidos gerados (30d)
  const [ordersGenerated30, ordersPaid30] = await Promise.all([
    db.order.count({ where: { ...orderAnyScope, createdAt: { gte: days30 } } }),
    db.order.count({ where: { ...orderScope, createdAt: { gte: days30 } } }),
  ]);
  const conversion = ordersGenerated30
    ? (ordersPaid30 / ordersGenerated30) * 100
    : 0;
  const pipelineValue = openOpps.reduce((s, o) => s + o.value, 0);

  // ranking por vendedor (30 dias) — só gerente/admin vê o time todo
  const allSales30 = canSeeAll(user)
    ? sales30
    : await db.sale.findMany({
        where: { companyId: user.companyId, createdAt: { gte: days30 } },
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

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title={`Olá, ${user.name.split(" ")[0]} 👋`}
        subtitle="Visão geral do comercial nos últimos 30 dias."
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
          label="Vendas (30d)"
          value={brl(revenue30)}
          hint={`${sales30.length} pedidos`}
          icon={<Wallet />}
        />
        <StatTile
          label="Ticket médio"
          value={brl(ticket)}
          icon={<TrendingUp />}
        />
        <StatTile
          label="Taxa de conversão"
          value={`${conversion.toFixed(0)}%`}
          hint={`${ordersPaid30} pagos · ${ordersGenerated30 - ordersPaid30} sem pagamento`}
          icon={<Percent />}
          tone={conversion >= 50 ? "good" : "warn"}
        />
        <StatTile
          label="Funil aberto"
          value={brl(pipelineValue)}
          hint={`${openOpps.length} oportunidades · ${negotiatingOpps} em fechamento`}
          icon={<Target />}
        />
        <StatTile
          label="Clientes"
          value={String(totalCustomers)}
          hint={`+${newLeads30} novos leads em 30d`}
          icon={<Users />}
        />
        <StatTile
          label="Vendas perdidas (30d)"
          value={String(lostOpps30)}
          icon={<AlertTriangle />}
          tone={lostOpps30 > 3 ? "bad" : "default"}
        />
        <StatTile
          label="Sem contato há 7+ dias"
          value={String(noContactCustomers.length)}
          hint="clientes esfriando"
          icon={<CalendarClock />}
          tone={noContactCustomers.length > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Follow-ups atrasados"
          value={String(overdue)}
          icon={<AlertTriangle />}
          tone={overdue > 0 ? "bad" : "good"}
        />
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
        />
        <StatTile
          label="Pagos na semana"
          value={String(ordersWeek._count)}
          hint={brl(ordersWeek._sum.total ?? 0)}
          icon={<ShoppingBag />}
        />
        <StatTile
          label="Pagos no mês"
          value={String(ordersMonth._count)}
          hint={`valor médio ${brl(avgOrder)}`}
          icon={<ShoppingBag />}
        />
        <StatTile
          label="Taxa de recompra"
          value={`${repurchaseRate.toFixed(0)}%`}
          hint="clientes com 2+ pedidos"
          icon={<Repeat />}
          tone={repurchaseRate >= 30 ? "good" : "warn"}
        />
      </div>

      {(topItems.length > 0 || topBuyers.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-6">
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Package className="size-4 text-brand-600" />
              Produtos mais vendidos
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
