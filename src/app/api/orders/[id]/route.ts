import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderStatusLabel, orderNumber, PAID_ORDER_STATUSES } from "@/lib/orders";

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
  sellerId: z.string().nullable().optional(), // vendedor responsável pela venda
  customerId: z.string().optional(), // vincula o pedido a um cliente já cadastrado
  paymentMethod: z
    .enum(["PIX", "CARTAO", "BOLETO", "CHEQUE", "DINHEIRO", "OUTRO"])
    .optional(), // forma de pagamento
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

    const newStatus = parsed.data.status;
    // Estados em que o pedido está pago → o estoque deve estar baixado.
    const PAID_STATUSES = new Set<string>(PAID_ORDER_STATUSES);
    const willChangeStatus = !!newStatus && newStatus !== order.status;
    const needDeduct =
      willChangeStatus && PAID_STATUSES.has(newStatus!) && !order.stockDeducted;
    const needReturn =
      willChangeStatus && !PAID_STATUSES.has(newStatus!) && order.stockDeducted;

    // Antes de escrever: se o pedido vai baixar estoque agora (virou pago),
    // confere disponibilidade e bloqueia se faltar.
    if (needDeduct) {
      const variantIds = order.items
        .map((i) => i.variantId)
        .filter((v): v is string => !!v);
      const variants = await db.productVariant.findMany({
        where: { id: { in: variantIds } },
      });
      const stockById = new Map(variants.map((v) => [v.id, v.stock]));
      for (const item of order.items) {
        if (!item.variantId) continue;
        const avail = stockById.get(item.variantId) ?? 0;
        if (avail < item.quantity) {
          return NextResponse.json(
            {
              error: `Estoque insuficiente de ${item.name} (${item.color} ${item.size}): restam ${avail}`,
            },
            { status: 409 }
          );
        }
      }
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.sellerId !== undefined) {
      if (parsed.data.sellerId) {
        const seller = await db.user.findFirst({
          where: { id: parsed.data.sellerId, companyId: user.companyId },
        });
        if (!seller) {
          return NextResponse.json({ error: "Vendedor inválido" }, { status: 404 });
        }
      }
      data.sellerId = parsed.data.sellerId;
    }
    if (parsed.data.customerId && parsed.data.customerId !== order.customerId) {
      const customer = await db.customer.findFirst({
        where: { id: parsed.data.customerId, companyId: user.companyId },
      });
      if (!customer) {
        return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
      }
      data.customerId = customer.id;
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "NOTA",
          description: `Pedido vinculado ao cliente ${customer.name} por ${user.name}`,
          userId: user.id,
        },
      });
    }

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

      // Pular etapas segue a lógica completa: entrar em qualquer etapa paga
      // (Pago, Em produção, Separação, Enviado, Entregue) vindo de uma etapa
      // não paga confirma o pagamento e registra a venda no CRM.
      if (PAID_STATUSES.has(newStatus) && !PAID_STATUSES.has(order.status)) {
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
            orderId: order.id,
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

      // Envio: Enviado marca a saída; Entregue implica que todo o processo
      // de envio foi executado (marca saída e entrega de uma vez).
      if (newStatus === "ENVIADO" || newStatus === "ENTREGUE") {
        const now = new Date();
        const shipData = {
          shippedAt: now,
          ...(newStatus === "ENTREGUE" ? { deliveredAt: now } : {}),
        };
        await db.shipping.upsert({
          where: { orderId: order.id },
          update: {
            ...(newStatus === "ENTREGUE" ? { deliveredAt: now } : {}),
            shippedAt: now,
          },
          create: { orderId: order.id, cost: order.shippingFee, ...shipData },
        });
      }
      // Voltar para antes do envio (ou cancelar) limpa as marcas de entrega
      if (["ORCAMENTO", "AGUARDANDO_PAGAMENTO", "PAGO", "EM_PRODUCAO", "SEPARACAO", "CANCELADO"].includes(newStatus)) {
        await db.shipping.updateMany({
          where: { orderId: order.id },
          data: { shippedAt: null, deliveredAt: null },
        });
      }

      // ---- Estoque: baixa quando vira pago; devolve ao cancelar/estornar ----
      if (needDeduct) {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await db.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { decrement: item.quantity } },
          });
        }
        await db.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: user.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "SAIDA" as const,
              quantity: i.quantity,
              reason: `Baixa por pagamento — pedido ${orderNumber(order.number)}`,
            })),
        });
        data.stockDeducted = true;
      } else if (needReturn) {
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
              reason:
                newStatus === "CANCELADO"
                  ? `Cancelamento do pedido ${orderNumber(order.number)}`
                  : `Estorno de estoque — pedido ${orderNumber(order.number)}`,
            })),
        });
        data.stockDeducted = false;
        // pagamento confirmado é estornado junto (cancelamento/estorno)
        await db.payment.updateMany({
          where: { orderId: order.id, status: "CONFIRMADO" },
          data: { status: newStatus === "CANCELADO" ? "ESTORNADO" : "PENDENTE" },
        });
        // a VENDA sai do faturamento: cancelou/estornou, não é mais venda
        await db.sale.deleteMany({ where: { orderId: order.id } });
      }
    }

    if (parsed.data.paymentMethod) {
      await db.payment.updateMany({
        where: { orderId: order.id },
        data: { method: parsed.data.paymentMethod },
      });
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
