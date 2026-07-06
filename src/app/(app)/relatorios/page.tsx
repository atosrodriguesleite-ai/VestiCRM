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
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope } from "@/lib/scope";
import { brl, dateShort, originLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { AreaChart, BarList, FunnelBars, StatTile } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await requireUser();
  const scope = ownedScope(user);
  const now = new Date();
  const days90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [sales, sellers, stages, opps, customers, interests, pendingTasks] =
    await Promise.all([
      db.sale.findMany({
        where: { companyId: user.companyId, createdAt: { gte: days90 } },
        include: { seller: true },
      }),
      db.user.findMany({ where: { companyId: user.companyId, active: true } }),
      db.stage.findMany({
        where: { pipeline: { companyId: user.companyId } },
        orderBy: { order: "asc" },
        include: { _count: { select: { opportunities: true } } },
      }),
      db.opportunity.findMany({ where: { companyId: user.companyId } }),
      db.customer.findMany({
        where: scope,
        include: { sales: { select: { total: true } } },
      }),
      db.interest.findMany({
        where: { companyId: user.companyId },
        include: { _count: { select: { customers: true } } },
      }),
      db.task.count({
        where: { companyId: user.companyId, status: "PENDENTE" },
      }),
    ]);

  // vendas por semana (últimas 12)
  const weeks: { label: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    weeks.push({
      label: dateShort(end),
      total: sales
        .filter((s) => s.createdAt >= start && s.createdAt < end)
        .reduce((sum, s) => sum + s.total, 0),
    });
  }

  // vendas por vendedor
  const bySeller = sellers
    .map((s) => ({
      label: s.name,
      value: sales
        .filter((v) => v.sellerId === s.id)
        .reduce((sum, v) => sum + v.total, 0),
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
      value: c.sales.reduce((s, v) => s + v.total, 0),
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

  const total90 = sales.reduce((s, v) => s + v.total, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Relatórios"
        subtitle="Números dos últimos 90 dias para decidir com clareza."
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
          <h2 className="font-semibold mb-4">Oportunidades por etapa do funil</h2>
          <FunnelBars data={funnel} />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <XCircle className="size-4 text-rose-500" />
            Motivos de perda
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
          <h2 className="font-semibold mb-4">Origem dos clientes</h2>
          <BarList
            data={originData}
            color="#0ea5e9"
            formatValue={(v) => `${v}`}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Gem className="size-4 text-brand-600" />
            Clientes mais valiosos
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
