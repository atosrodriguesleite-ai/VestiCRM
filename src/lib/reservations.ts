import { db } from "./db";
import { orderNumber } from "./orders";
import { pushStockToNuvemshop } from "./nuvemshop";
import { pushStockToJueri } from "./jueri";

/**
 * Expiração das reservas de estoque. Quando um vendedor monta um orçamento, a
 * peça sai do estoque na hora pra ninguém vender a mesma peça duas vezes. Mas
 * se a venda não fecha, a peça não pode ficar presa pra sempre: depois de 48h
 * sem virar pedido pago, a reserva é solta e o estoque volta sozinho.
 *
 * Solta só pedidos AINDA em orçamento/aguardando (não pagos) que estão
 * segurando estoque (stockDeducted) e foram criados há mais de 48h. Registra a
 * devolução (ENTRADA "Reserva expirada") e reflete nas integrações.
 *
 * Roda dentro do cron diário (2x/dia) — a janela de 48h tem folga de sobra.
 */

const RESERVA_HORAS = 48;

export async function releaseExpiredReservations() {
  const limite = new Date(Date.now() - RESERVA_HORAS * 60 * 60 * 1000);

  const expirados = await db.order.findMany({
    where: {
      status: { in: ["ORCAMENTO", "AGUARDANDO_PAGAMENTO"] },
      stockDeducted: true,
      createdAt: { lt: limite },
    },
    include: { items: true },
  });

  const soltos: { number: number; companyId: string }[] = [];

  for (const order of expirados) {
    try {
      await db.$transaction(async (tx) => {
        for (const it of order.items) {
          if (!it.variantId) continue;
          await tx.productVariant.update({
            where: { id: it.variantId },
            data: { stock: { increment: it.quantity } },
          });
        }
        await tx.inventoryMovement.createMany({
          data: order.items
            .filter((i) => i.variantId)
            .map((i) => ({
              companyId: order.companyId,
              variantId: i.variantId!,
              orderId: order.id,
              type: "ENTRADA" as const,
              quantity: i.quantity,
              reason: `Reserva expirada (48h) — pedido ${orderNumber(order.number)}`,
            })),
        });
        await tx.order.update({
          where: { id: order.id },
          data: { stockDeducted: false },
        });
      });

      // devolve o estoque solto pra origem (Nuvemshop absoluto / Jueri delta +)
      const variantIds = order.items
        .map((i) => i.variantId)
        .filter((v): v is string => !!v);
      if (variantIds.length > 0) {
        pushStockToNuvemshop(order.companyId, variantIds).catch(() => {});
        const changes = order.items
          .filter((i) => i.variantId)
          .map((i) => ({ variantId: i.variantId!, delta: i.quantity }));
        pushStockToJueri(order.companyId, changes).catch(() => {});
      }

      soltos.push({ number: order.number, companyId: order.companyId });
    } catch {
      // um pedido problemático não pode travar os outros
    }
  }

  return {
    verificados: expirados.length,
    soltos: soltos.length,
    pedidos: soltos.map((s) => orderNumber(s.number)),
  };
}
