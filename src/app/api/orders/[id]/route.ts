import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderStatusLabel, orderNumber } from "@/lib/orders";

const patchSchema = z.object({
  status: z
    .enum([
      "ORCAMENTO",
      "AGUARDANDO_PAGAMENTO",
      "PAGO",
      "EM_PRODUCAO",
      "SEPARACAO",
      "ENVIADO",
      "ENTREGUE",
      "CANCELADO",
    ])
    .optional(),
  notes: z.string().nullable().optional(),
  trackingCode: z.string().nullable().optional(),
  shippingMethod: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const order = await db.order.findFirst({
      where: { id, companyId: user.companyId },
      include: { items: true, payments: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

    const newStatus = parsed.data.status;
    if (newStatus && newStatus !== order.status) {
      data.status = newStatus;

      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "STATUS",
          description: `Status alterado para "${orderStatusLabel[newStatus]}" por ${user.name}`,
          userId: user.id,
        },
      });

      // pagamento confirmado → quita o pagamento e registra venda no CRM
      if (newStatus === "PAGO" && order.status !== "PAGO") {
        const pending = order.payments.find((p) => p.status === "PENDENTE");
        if (pending) {
          await db.payment.update({
            where: { id: pending.id },
            data: { status: "CONFIRMADO", paidAt: new Date() },
          });
        }
        await db.sale.create({
          data: {
            companyId: user.companyId,
            customerId: order.customerId,
            sellerId: order.sellerId,
            total: order.total,
            description: `Pedido ${orderNumber(order.number)}`,
            category: "Pedido",
          },
        });
        await db.customer.update({
          where: { id: order.customerId },
          data: { lastPurchaseAt: new Date() },
        });
      }

      // envio
      if (newStatus === "ENVIADO") {
        await db.shipping.update({
          where: { orderId: order.id },
          data: { shippedAt: new Date() },
        });
      }
      if (newStatus === "ENTREGUE") {
        await db.shipping.update({
          where: { orderId: order.id },
          data: { deliveredAt: new Date() },
        });
      }

      // cancelamento → devolve o estoque reservado
      if (newStatus === "CANCELADO" && order.status !== "CANCELADO") {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await db.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await db.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: user.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "ENTRADA" as const,
              quantity: i.quantity,
              reason: `Cancelamento do pedido ${orderNumber(order.number)}`,
            })),
        });
      }
    }

    if (
      parsed.data.trackingCode !== undefined ||
      parsed.data.shippingMethod !== undefined
    ) {
      await db.shipping.update({
        where: { orderId: order.id },
        data: {
          ...(parsed.data.trackingCode !== undefined
            ? { trackingCode: parsed.data.trackingCode }
            : {}),
          ...(parsed.data.shippingMethod !== undefined
            ? { method: parsed.data.shippingMethod }
            : {}),
        },
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "ENVIO",
          description: `Dados de envio atualizados por ${user.name}`,
          userId: user.id,
        },
      });
    }

    const updated = await db.order.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
