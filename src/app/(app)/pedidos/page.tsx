import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeAll } from "@/lib/scope";
import { brl, dateShort, timeShort } from "@/lib/format";
import {
  orderStatusLabel,
  orderStatusColor,
  orderNumber,
  ORDER_STATUS_FLOW,
} from "@/lib/orders";
import { Card, PageHeader, Avatar, Badge, EmptyState } from "@/components/ui";
import type { OrderStatus, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const { status } = await searchParams;

  const where: Prisma.OrderWhereInput = canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
  if (status && ORDER_STATUS_FLOW.includes(status as OrderStatus)) {
    where.status = status as OrderStatus;
  }

  const [orders, counts] = await Promise.all([
    db.order.findMany({
      where,
      include: {
        customer: true,
        seller: true,
        items: { take: 3 },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.order.groupBy({
      by: ["status"],
      where: canSeeAll(user)
        ? { companyId: user.companyId }
        : { companyId: user.companyId, sellerId: user.id },
      _count: true,
    }),
  ]);

  const countByStatus = Object.fromEntries(
    counts.map((c) => [c.status, c._count])
  );
  const totalCount = counts.reduce((s, c) => s + c._count, 0);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Pedidos"
        subtitle="Todos os pedidos e orçamentos da loja, do carrinho à entrega."
      />

      <div className="flex gap-1.5 mb-4 overflow-x-auto thin-scroll pb-1">
        <Link
          href="/pedidos"
          className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
            !status
              ? "bg-brand-600 text-white"
              : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
          }`}
        >
          Todos ({totalCount})
        </Link>
        {ORDER_STATUS_FLOW.map((s) => (
          <Link
            key={s}
            href={`/pedidos?status=${s}`}
            className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
              status === s
                ? "bg-brand-600 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:border-brand-300"
            }`}
          >
            {orderStatusLabel[s]}
            {countByStatus[s] ? ` (${countByStatus[s]})` : ""}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag />}
            title="Nenhum pedido aqui"
            hint="Monte um pedido direto da conversa do WhatsApp com o botão de sacola."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Link key={o.id} href={`/pedidos/${o.id}`} className="block">
              <Card className="p-4 hover:shadow-pop transition">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-brand-700 tabular-nums shrink-0 w-14">
                    {orderNumber(o.number)}
                  </span>
                  <Avatar name={o.customer.name} color={o.seller?.color ?? "#7c3aed"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {o.customer.name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {o._count.items}{" "}
                      {o._count.items === 1 ? "item" : "itens"} ·{" "}
                      {o.items.map((i) => i.name).join(", ")}
                    </p>
                  </div>
                  <div className="hidden sm:block text-right shrink-0">
                    <p className="text-xs text-gray-400">
                      {dateShort(o.createdAt)} {timeShort(o.createdAt)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {o.seller?.name ?? "—"}
                    </p>
                  </div>
                  <Badge color={orderStatusColor[o.status]}>
                    {orderStatusLabel[o.status]}
                  </Badge>
                  <span className="text-sm font-semibold tabular-nums shrink-0 w-24 text-right">
                    {brl(o.total)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
