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
import { NewOrderButton } from "./new-order";
import type { OrderStatus, Prisma } from "@prisma/client";

// converte YYYY-MM-DD (fuso de São Paulo, UTC-3) em Date UTC
const SP_OFFSET = 3 * 60 * 60 * 1000;
function spDayStart(d: string) {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
}
function spDayEnd(d: string) {
  const t = Date.parse(`${d}T23:59:59.999Z`);
  return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
}

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  const { status, de, ate } = await searchParams;

  const from = de ? spDayStart(de) : null;
  const to = ate ? spDayEnd(ate) : null;

  const where: Prisma.OrderWhereInput = canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
  if (status && ORDER_STATUS_FLOW.includes(status as OrderStatus)) {
    where.status = status as OrderStatus;
  }
  if (from || to) {
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  const dateQS = `${de ? `&de=${de}` : ""}${ate ? `&ate=${ate}` : ""}`;

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
      where: {
        ...(canSeeAll(user)
          ? { companyId: user.companyId }
          : { companyId: user.companyId, sellerId: user.id }),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
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
        action={<NewOrderButton />}
      />

      {/* Filtro de período (fuso de São Paulo) */}
      <form className="flex flex-wrap items-end gap-2 mb-4" method="GET">
        {status && <input type="hidden" name="status" value={status} />}
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
        {(de || ate) && (
          <Link href={status ? `/pedidos?status=${status}` : "/pedidos"} className="text-xs font-medium text-gray-400 hover:text-gray-600 px-2 py-2.5">
            Limpar período
          </Link>
        )}
      </form>

      <div className="flex gap-1.5 mb-4 overflow-x-auto thin-scroll pb-1">
        <Link
          href={`/pedidos${dateQS ? `?${dateQS.slice(1)}` : ""}`}
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
            href={`/pedidos?status=${s}${dateQS}`}
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
                  <Avatar name={o.customer.name} color={o.seller?.color ?? "#6d28ff"} />
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
