import {
  BarChart3,
  TrendingUp,
  Users,
  Clock,
  XCircle,
  Gem,
  Moon,
  Shirt,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope, isManagerUp } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { brl, dateShort, originLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { AreaChart, BarList, FunnelBars, StatTile } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await requireUser();
  // Relatórios são visão geral da loja: vendedor comum não acessa
  if (!isManagerUp(user)) redirect("/dashboard");
  const scope = ownedScope(user);
  const now = new Date();
  const days90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Venda = pedido PAGO (fonte única da verdade, igual Dashboard/Inteligência).
  // Inclui vendas integradas (Nuvemshop etc.), que entram como pedido pago
  // direto — o modelo Sale não cobre esses fluxos e subcontava.
  const paidScope = {
    companyId: user.companyId,
    status: { in: PAID_ORDER_STATUSES },
  };
  const [sales, sellers, stages, opps, customers, interests, pendingTasks, conversations] =
    await Promise.all([
      db.order.findMany({
        where: { ...paidScope, paidAt: { gte: days90 } },
        select: { netTotal: true, paidAt: true, sellerId: true },
      }),
      // sem filtro de ativo: quem vendeu no período aparece no ranking mesmo
      // depois de desligado (senão o gráfico não fecha com o faturamento)
      db.user.findMany({ where: { companyId: user.companyId } }),
      db.stage.findMany({
        where: { pipeline: { companyId: user.companyId } },
        orderBy: { order: "asc" },
        include: { _count: { select: { opportunities: true } } },
      }),
      db.opportunity.findMany({ where: { companyId: user.companyId } }),
      db.customer.findMany({
        where: scope,
        include: {
          orders: {
            where: { status: { in: PAID_ORDER_STATUSES } },
            select: { netTotal: true },
          },
        },
      }),
      db.interest.findMany({
        where: { companyId: user.companyId },
        include: { _count: { select: { customers: true } } },
      }),
      db.task.count({
        where: { companyId: user.companyId, status: "PENDENTE" },
      }),
      db.conversation.findMany({
        where: { companyId: user.companyId },
        include: {
          messages: { orderBy: { createdAt: "asc" }, select: { direction: true, createdAt: true } },
        },
      }),
    ]);

  // ---- Canais de aquisição (Lead Intake Engine) ----
  const customersFull = await db.customer.findMany({
    where: { companyId: user.companyId },
    include: {
      orders: {
        where: { status: { in: PAID_ORDER_STATUSES } },
        select: { netTotal: true, paidAt: true },
      },
    },
  });
  type ChannelStat = {
    origin: string;
    leads: number;
    buyers: number;
    revenue: number;
    daysToSale: number[];
  };
  const channelMap = new Map<string, ChannelStat>();
  for (const c of customersFull) {
    const key = originLabel[c.origin];
    const stat =
      channelMap.get(key) ??
      { origin: key, leads: 0, buyers: 0, revenue: 0, daysToSale: [] };
    stat.leads += 1;
    if (c.orders.length > 0) {
      stat.buyers += 1;
      stat.revenue += c.orders.reduce((s, v) => s + v.netTotal, 0);
      // data da compra = data do PAGAMENTO (pedido pago sem data não entra)
      const pagos = c.orders.map((o) => o.paidAt).filter((d): d is Date => !!d);
      if (pagos.length) {
        const firstSale = pagos.reduce((min, d) => (d < min ? d : min), pagos[0]);
        stat.daysToSale.push(
          Math.max(0, (firstSale.getTime() - c.createdAt.getTime()) / (24 * 60 * 60 * 1000))
        );
      }
    }
    channelMap.set(key, stat);
  }
  const channels = [...channelMap.values()].sort((a, b) => b.revenue - a.revenue);
  const bestChannel = channels[0];
  const avgDaysToSale = (() => {
    const all = channels.flatMap((c) => c.daysToSale);
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  })();

  // tempo médio até a primeira resposta (1ª msg OUT depois da 1ª IN)
  const responseTimes: number[] = [];
  for (const conv of conversations) {
    const firstIn = conv.messages.find((m) => m.direction === "IN");
    if (!firstIn) continue;
    const firstOut = conv.messages.find(
      (m) => m.direction === "OUT" && m.createdAt > firstIn.createdAt
    );
    if (firstOut) {
      responseTimes.push(
        (firstOut.createdAt.getTime() - firstIn.createdAt.getTime()) / 60000
      );
    }
  }
  const avgResponseMin = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;
  const fmtDuration = (min: number) =>
    min >= 60 * 24
      ? `${(min / (60 * 24)).toFixed(1)} dias`
      : min >= 60
        ? `${(min / 60).toFixed(1)} h`
        : `${Math.round(min)} min`;

  // vendas por semana (últimas 12)
  const weeks: { label: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    weeks.push({
      label: dateShort(end),
      total: sales
        .filter((s) => s.paidAt && s.paidAt >= start && s.paidAt < end)
        .reduce((sum, s) => sum + s.netTotal, 0),
    });
  }

  // vendas por vendedor
  const bySeller = sellers
    .map((s) => ({
      label: s.name,
      value: sales
        .filter((v) => v.sellerId === s.id)
        .reduce((sum, v) => sum + v.netTotal, 0),
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // funil: contagem por etapa (histórico de oportunidades)
  const funnel = stages.map((s) => ({
    label: s.name,
    value: s._count.opportunities,
  }));

  // motivos de perda
  const lostReasons = new Map<string, number>();
  for (const o of opps.filter((o) => o.status === "LOST")) {
    const reason = o.lostReason?.trim() || "Sem motivo registrado";
    lostReasons.set(reason, (lostReasons.get(reason) ?? 0) + 1);
  }
  const lossData = [...lostReasons.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // origem dos clientes
  const byOrigin = new Map<string, number>();
  for (const c of customers) {
    const label = originLabel[c.origin];
    byOrigin.set(label, (byOrigin.get(label) ?? 0) + 1);
  }
  const originData = [...byOrigin.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // clientes mais valiosos
  const topCustomers = customers
    .map((c) => ({
      label: c.name,
      value: c.orders.reduce((s, v) => s + v.netTotal, 0),
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // inativos
  const inactive = (days: number) =>
    customers.filter(
      (c) =>
        !c.lastPurchaseAt ||
        c.lastPurchaseAt < new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    ).length;

  // tempo médio de fechamento (ganhas)
  const won = opps.filter((o) => o.status === "WON" && o.closedAt);
  const avgClose =
    won.length > 0
      ? won.reduce(
          (s, o) =>
            s +
            (o.closedAt!.getTime() - o.createdAt.getTime()) /
              (24 * 60 * 60 * 1000),
          0
        ) / won.length
      : 0;

  // produtos mais desejados
  const desired = interests
    .map((i) => ({ label: i.name, value: i._count.customers }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);

  const total90 = sales.reduce((s, v) => s + v.netTotal, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Relatórios"
        subtitle="Faturamento e vendas dos últimos 90 dias; os blocos de base de clientes mostram o histórico completo (cada um diz o seu período)."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatTile
          label="Faturamento (90d)"
          value={brl(total90)}
          hint={`${sales.length} vendas`}
          icon={<TrendingUp />}
        />
        <StatTile
          label="Tempo médio de fechamento"
          value={`${avgClose.toFixed(0)} dias`}
          hint={`${won.length} pedidos ganhos`}
          icon={<Clock />}
        />
        <StatTile
          label="Clientes inativos 60d+"
          value={String(inactive(60))}
          hint={`${inactive(30)} há 30d+ · ${inactive(90)} há 90d+`}
          icon={<Moon />}
          tone={inactive(60) > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Follow-ups pendentes"
          value={String(pendingTasks)}
          icon={<Users />}
          tone={pendingTasks > 10 ? "warn" : "default"}
        />
      </div>

      {/* Canais de aquisição */}
      <h2 className="font-semibold mb-3 text-sm text-gray-600">
        Canais de aquisição <span className="font-normal text-gray-400">(histórico completo)</span>
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
        <StatTile
          label="Melhor canal"
          value={bestChannel?.origin ?? "—"}
          hint={bestChannel ? `${brl(bestChannel.revenue)} vendidos` : undefined}
          tone="good"
        />
        <StatTile
          label="1ª resposta (média)"
          value={fmtDuration(avgResponseMin)}
          hint={`${conversations.length} conversas analisadas`}
        />
        <StatTile
          label="Tempo até a venda"
          value={`${avgDaysToSale.toFixed(0)} dias`}
          hint="do lead à 1ª compra"
        />
        <StatTile
          label="Canais ativos"
          value={String(channels.length)}
          hint="origens com leads"
        />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 md:gap-6 mb-6">
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Leads por origem <span className="text-xs font-normal text-gray-400">· histórico</span></h2>
          <BarList
            data={channels
              .slice()
              .sort((a, b) => b.leads - a.leads)
              .map((c) => ({ label: c.origin, value: c.leads }))}
            formatValue={(v) => `${v}`}
          />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Valor vendido por canal <span className="text-xs font-normal text-gray-400">· histórico</span></h2>
          <BarList
            color="#10b981"
            data={channels
              .filter((c) => c.revenue > 0)
              .map((c) => ({
                label: c.origin,
                value: c.revenue,
                sub: `ticket médio ${brl(c.buyers ? c.revenue / c.buyers : 0)}`,
              }))}
            formatValue={brl}
          />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Conversão por origem <span className="text-xs font-normal text-gray-400">· histórico</span></h2>
          <BarList
            color="#0ea5e9"
            data={channels
              .slice()
              .sort((a, b) => b.buyers / b.leads - a.buyers / a.leads)
              .map((c) => ({
                label: c.origin,
                value: Math.round((c.buyers / c.leads) * 100),
                sub: `${c.buyers} de ${c.leads} leads compraram`,
              }))}
            formatValue={(v) => `${v}%`}
          />
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <BarChart3 className="size-4 text-brand-600" />
            Vendas por semana
          </h2>
          <AreaChart
            points={weeks.map((w) => w.total)}
            labels={weeks.map((w) => w.label)}
            formatValue={brl}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">Vendas por vendedor (90d)</h2>
          {bySeller.length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <BarList data={bySeller} formatValue={brl} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">Oportunidades por etapa do funil <span className="text-xs font-normal text-gray-400">· posição atual</span></h2>
          <FunnelBars data={funnel} />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <XCircle className="size-4 text-rose-500" />
            Motivos de perda <span className="text-xs font-normal text-gray-400">· histórico</span>
          </h2>
          {lossData.length === 0 ? (
            <EmptyState title="Nenhuma negociação perdida 🎉" />
          ) : (
            <BarList
              data={lossData}
              color="#e34948"
              formatValue={(v) => `${v} negócio${v === 1 ? "" : "s"}`}
            />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">Origem dos clientes <span className="text-xs font-normal text-gray-400">· histórico</span></h2>
          <BarList
            data={originData}
            color="#0ea5e9"
            formatValue={(v) => `${v}`}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Gem className="size-4 text-brand-600" />
            Clientes mais valiosos <span className="text-xs font-normal text-gray-400">· histórico</span>
          </h2>
          {topCustomers.length === 0 ? (
            <EmptyState title="Sem compras registradas" />
          ) : (
            <BarList data={topCustomers} color="#10b981" formatValue={brl} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Shirt className="size-4 text-brand-600" />
            Produtos mais desejados
          </h2>
          {desired.length === 0 ? (
            <EmptyState title="Sem interesses registrados" />
          ) : (
            <BarList
              data={desired}
              formatValue={(v) => `${v} cliente${v === 1 ? "" : "s"}`}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
