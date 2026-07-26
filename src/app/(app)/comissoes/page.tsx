import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp, isAdmin } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { PageHeader } from "@/components/ui";
import { CommissionsView } from "./commissions-view";

export const dynamic = "force-dynamic";

const SP_OFFSET = 3 * 60 * 60 * 1000; // São Paulo (UTC-3)
const spStart = (d?: string) => {
  const t = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
};
const spEnd = (d?: string) => {
  const t = d ? Date.parse(`${d}T23:59:59.999Z`) : NaN;
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
};

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  // Comissões são visão geral da loja: só gerente/admin.
  if (!isManagerUp(user)) redirect("/dashboard");
  const { de, ate } = await searchParams;

  // período padrão: mês corrente (em São Paulo)
  const now = new Date();
  const spNow = new Date(now.getTime() - SP_OFFSET);
  const defFrom = new Date(Date.UTC(spNow.getUTCFullYear(), spNow.getUTCMonth(), 1) + SP_OFFSET);
  const from = spStart(de) ?? defFrom;
  const to = spEnd(ate) ?? now;

  const company = await db.company.findUnique({ where: { id: user.companyId } });
  const base = (company?.commissionBase ?? "SUBTOTAL") as "SUBTOTAL" | "TOTAL";

  // TODOS os vendedores (inclusive desligados): quem trabalhou no período
  // TEM comissão a receber. Filtrar por ativo fazia o dinheiro sumir do
  // relatório — o pedido tem vendedor, então nem entrava em "sem vendedor".
  const sellers = await db.user.findMany({
    where: { companyId: user.companyId, role: { not: "SUPERADMIN" } },
    select: {
      id: true,
      name: true,
      color: true,
      role: true,
      commissionRate: true,
      active: true,
    },
    orderBy: { name: "asc" },
  });

  // pedidos PAGOS no período (fonte única = igual ao faturamento)
  const paidOrders = await db.order.findMany({
    where: {
      companyId: user.companyId,
      status: { in: PAID_ORDER_STATUSES },
      createdAt: { gte: from, lte: to },
    },
    select: { sellerId: true, subtotal: true, total: true },
  });

  const bySeller = new Map<string, { count: number; base: number }>();
  let unassigned = { count: 0, base: 0 };
  for (const o of paidOrders) {
    const val = base === "TOTAL" ? o.total : o.subtotal;
    if (!o.sellerId) {
      unassigned = { count: unassigned.count + 1, base: unassigned.base + val };
      continue;
    }
    const cur = bySeller.get(o.sellerId) ?? { count: 0, base: 0 };
    bySeller.set(o.sellerId, { count: cur.count + 1, base: cur.base + val });
  }

  const rows = sellers
    // desligado só aparece se vendeu no período (senão polui a lista)
    .filter((s) => s.active || (bySeller.get(s.id)?.count ?? 0) > 0)
    .map((s) => {
      const agg = bySeller.get(s.id) ?? { count: 0, base: 0 };
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        rate: s.commissionRate,
        orders: agg.count,
        base: agg.base,
        commission: (agg.base * s.commissionRate) / 100,
        inactive: !s.active,
      };
    });

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Comissões"
        subtitle="Comissão dos vendedores sobre os pedidos pagos no período."
      />
      <CommissionsView
        rows={rows}
        base={base}
        canEdit={isAdmin(user)}
        de={de ?? ""}
        ate={ate ?? ""}
        unassigned={unassigned}
      />
    </div>
  );
}
