import { db } from "./db";
import { orderNumber, PAID_ORDER_STATUSES } from "./orders";
import { notifySalePaid } from "./push";
import { pushStockToNuvemshop } from "./nuvemshop";
import { pushStockToJueri } from "./jueri";

/**
 * Liquidação AUTOMÁTICA de pedido pago (Pix confirmado pelo gateway).
 * Espelha a transição manual para PAGO da tela de Pedidos: baixa/confirma o
 * estoque (com movimento), registra a venda (Sale), marca o pagamento,
 * atualiza o cliente e dispara o push 💰.
 *
 * Diferença IMPORTANTE do fluxo manual: aqui o dinheiro JÁ CAIU — nunca
 * recusamos a confirmação. Se faltar estoque, o pedido vira PAGO mesmo
 * assim e fica um aviso no histórico para a loja resolver a divergência.
 */
export async function settleOrderPaid(
  orderId: string,
  origem: string // ex.: "Pix (Mercado Pago)"
): Promise<{ ok: boolean; already?: boolean }> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, payments: true },
  });
  if (!order) return { ok: false };

  // já pago (webhook repetido) → só garante o pagamento confirmado
  if ((PAID_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    await db.payment.updateMany({
      where: { orderId: order.id, status: "PENDENTE" },
      data: { status: "CONFIRMADO", paidAt: new Date() },
    });
    return { ok: true, already: true };
  }
  if (order.status === "CANCELADO") {
    // pagamento de pedido cancelado: registra no histórico para a loja ver
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTA",
        description: `⚠️ Pagamento recebido via ${origem}, mas o pedido está CANCELADO — verifique (estorno ou reativação).`,
      },
    });
    return { ok: false };
  }

  const agora = new Date();

  // estoque: baixa se ainda não estava reservado/baixado
  if (!order.stockDeducted) {
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
          companyId: order.companyId,
          variantId: i.variantId!,
          orderId: order.id,
          type: "SAIDA" as const,
          quantity: i.quantity,
          reason: `Baixa por pagamento — pedido ${orderNumber(order.number)}`,
        })),
    });
    // estoque negativo = vendeu mais do que tinha: zera e avisa no histórico
    const negativos = await db.productVariant.findMany({
      where: {
        id: { in: order.items.map((i) => i.variantId).filter((v): v is string => !!v) },
        stock: { lt: 0 },
      },
      select: { id: true },
    });
    if (negativos.length > 0) {
      await db.productVariant.updateMany({
        where: { id: { in: negativos.map((n) => n.id) } },
        data: { stock: 0 },
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          type: "NOTA",
          description:
            "⚠️ Pagamento confirmado com estoque insuficiente em parte dos itens — confira a disponibilidade antes de separar.",
        },
      });
    }
  }

  await db.order.update({
    where: { id: order.id },
    data: { status: "PAGO", stockDeducted: true },
  });
  await db.payment.updateMany({
    where: { orderId: order.id, status: "PENDENTE" },
    data: { status: "CONFIRMADO", paidAt: agora },
  });
  await db.sale.create({
    data: {
      companyId: order.companyId,
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
    data: { lastPurchaseAt: agora, lastContactAt: agora },
  });
  await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: "STATUS",
      description: `Status alterado para "Pago" automaticamente — pagamento confirmado via ${origem} ✅`,
    },
  });
  if (!order.sellerId) {
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTA",
        description: "Pedido pago sem vendedor atribuído — atribua em \"Editar dados\" para contar na comissão.",
      },
    });
  }

  // integrações donas de estoque espelham a baixa (uma venda, uma baixa)
  if (!order.stockDeducted) {
    const variantIds = order.items
      .map((i) => i.variantId)
      .filter((v): v is string => !!v);
    pushStockToNuvemshop(order.companyId, variantIds).catch(() => {});
    pushStockToJueri(
      order.companyId,
      order.items
        .filter((i) => i.variantId)
        .map((i) => ({ variantId: i.variantId!, delta: -i.quantity }))
    ).catch(() => {});
  }

  // 💰 o "ka-ching" no celular da loja
  const customer = await db.customer.findUnique({
    where: { id: order.customerId },
    select: { name: true },
  });
  notifySalePaid(order.companyId, {
    id: order.id,
    number: order.number,
    total: order.total,
    customerName: customer?.name ?? "Cliente",
  }).catch(() => {});

  return { ok: true };
}
