import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  MessageCircle,
  Truck,
  CreditCard,
  History,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { brl, dateFull, dateShort, timeShort, formatPhone } from "@/lib/format";
import {
  orderStatusLabel,
  orderStatusColor,
  orderNumber,
  paymentMethodLabel,
} from "@/lib/orders";
import { Card, Avatar, Badge } from "@/components/ui";
import { StatusChanger } from "./status-changer";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const order = await db.order.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      customer: true,
      seller: true,
      conversation: true,
      items: true,
      payments: { orderBy: { createdAt: "asc" } },
      shipping: true,
      events: { orderBy: { createdAt: "desc" }, include: { user: true } },
    },
  });
  if (!order) notFound();

  return (
    <div className="max-w-5xl mx-auto">
      <Link
        href="/pedidos"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4 transition"
      >
        <ArrowLeft className="size-4" />
        Pedidos
      </Link>

      <Card className="p-5 md:p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight">
                Pedido {orderNumber(order.number)}
              </h1>
              <Badge color={orderStatusColor[order.status]}>
                {orderStatusLabel[order.status]}
              </Badge>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Criado em {dateFull(order.createdAt)} às {timeShort(order.createdAt)}
              {order.seller ? ` · Vendedor(a): ${order.seller.name}` : ""}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Avatar name={order.customer.name} color="#2563eb" size="sm" />
              <Link
                href={`/clientes/${order.customerId}`}
                className="text-sm font-medium hover:text-brand-600"
              >
                {order.customer.name}
              </Link>
              <span className="text-xs text-gray-400">
                {formatPhone(order.customer.phone)}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <a
              href={`/api/orders/${order.id}/pdf`}
              target="_blank"
              className="flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
            >
              <FileText className="size-4" />
              Orçamento em PDF
            </a>
            {order.conversationId && (
              <Link
                href="/whatsapp"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 hover:border-emerald-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
              >
                <MessageCircle className="size-4 text-emerald-500" />
                Ver conversa
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-gray-50">
          <StatusChanger orderId={order.id} current={order.status} />
        </div>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Itens */}
        <Card className="p-5 md:col-span-2">
          <h2 className="font-semibold mb-4">Itens do pedido</h2>
          <ul className="divide-y divide-gray-50">
            {order.items.map((item) => (
              <li key={item.id} className="py-3 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="size-12 rounded-xl object-cover bg-gray-50 shrink-0"
                  />
                ) : (
                  <div className="size-12 rounded-xl bg-gray-100 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-gray-400">
                    {[item.color, item.size].filter(Boolean).join(" · ")}
                    {item.sku ? ` · ${item.sku}` : ""}
                  </p>
                </div>
                <span className="text-xs text-gray-500 tabular-nums shrink-0">
                  {item.quantity} × {brl(item.unitPrice)}
                </span>
                <span className="text-sm font-semibold tabular-nums shrink-0 w-20 text-right">
                  {brl(item.total)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>Subtotal</span>
              <span className="tabular-nums">{brl(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-rose-500">
                <span>Desconto</span>
                <span className="tabular-nums">- {brl(order.discount)}</span>
              </div>
            )}
            {order.shippingFee > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Frete</span>
                <span className="tabular-nums">{brl(order.shippingFee)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base pt-1">
              <span>Total</span>
              <span className="tabular-nums text-brand-700">
                {brl(order.total)}
              </span>
            </div>
          </div>
          {order.notes && (
            <p className="mt-4 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {order.notes}
            </p>
          )}
        </Card>

        <div className="space-y-4">
          {/* Pagamento */}
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <CreditCard className="size-4 text-brand-600" />
              Pagamento
            </h2>
            {order.payments.map((p) => (
              <div key={p.id} className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {paymentMethodLabel[p.method]}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {brl(p.amount)}
                  </span>
                </div>
                <Badge
                  color={
                    p.status === "CONFIRMADO"
                      ? "#059669"
                      : p.status === "ESTORNADO"
                        ? "#e11d48"
                        : "#d97706"
                  }
                >
                  {p.status === "CONFIRMADO"
                    ? `Pago ${p.paidAt ? dateShort(p.paidAt) : ""}`
                    : p.status === "ESTORNADO"
                      ? "Estornado"
                      : "Pendente"}
                </Badge>
              </div>
            ))}
          </Card>

          {/* Frete */}
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <Truck className="size-4 text-brand-600" />
              Entrega
            </h2>
            <div className="text-sm space-y-1 text-gray-500">
              <p>
                {[order.shipping?.city, order.shipping?.state]
                  .filter(Boolean)
                  .join("/") || "Endereço a definir"}
              </p>
              {order.shipping?.method && <p>Via {order.shipping.method}</p>}
              {order.shipping?.trackingCode && (
                <p className="font-mono text-xs bg-gray-50 rounded-lg px-2 py-1">
                  {order.shipping.trackingCode}
                </p>
              )}
              {order.shipping?.shippedAt && (
                <p className="text-xs">
                  Enviado em {dateFull(order.shipping.shippedAt)}
                </p>
              )}
              {order.shipping?.deliveredAt && (
                <p className="text-xs text-emerald-600">
                  Entregue em {dateFull(order.shipping.deliveredAt)}
                </p>
              )}
            </div>
          </Card>

          {/* Timeline */}
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <History className="size-4 text-brand-600" />
              Histórico
            </h2>
            <ul className="space-y-3">
              {order.events.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <span className="size-2 rounded-full bg-brand-300 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-600 leading-snug">
                      {e.description}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {dateShort(e.createdAt)} {timeShort(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
