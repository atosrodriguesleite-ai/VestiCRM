import type { Prisma } from "@prisma/client";

/**
 * O LIVRO DE MOVIMENTOS É A VERDADE DO ESTOQUE DO PEDIDO.
 *
 * Auditoria preventiva (05/08/2026): cancelar/excluir pedido devolvia a
 * QUANTIDADE DO ITEM, não o que tinha realmente saído do estoque. Três
 * buracos com a mesma raiz:
 *  • reserva parcial do catálogo (pediu 10, havia 4) devolvia 10;
 *  • item religado a outra variação (reimportação) devolvia numa peça que
 *    nunca teve baixa;
 *  • duplo cancelamento devolvia em dobro.
 *
 * Aqui a devolução é reconstruída dos `InventoryMovement` do pedido:
 * saiu − voltou, por variação. Devolve-se EXATAMENTE isso — nem uma peça a
 * mais, e nunca duas vezes (depois de devolver, o líquido zera).
 */

type TxComMovimentos = Pick<
  Prisma.TransactionClient,
  "inventoryMovement" | "productVariant"
>;

/** Quanto este pedido ainda tem de estoque "na mão", por variação. */
export async function baixasLiquidasDoPedido(
  tx: TxComMovimentos,
  orderId: string
): Promise<Map<string, number>> {
  const movs = await tx.inventoryMovement.findMany({
    where: { orderId },
    select: { variantId: true, type: true, quantity: true },
  });
  return liquidoDosMovimentos(movs);
}

/** A conta pura (testável): SAÍDA soma, ENTRADA subtrai; só positivos ficam. */
export function liquidoDosMovimentos(
  movs: { variantId: string | null; type: string; quantity: number }[]
): Map<string, number> {
  const net = new Map<string, number>();
  for (const m of movs) {
    if (!m.variantId) continue;
    if (m.type === "SAIDA") net.set(m.variantId, (net.get(m.variantId) ?? 0) + m.quantity);
    else if (m.type === "ENTRADA")
      net.set(m.variantId, (net.get(m.variantId) ?? 0) - m.quantity);
    // AJUSTE não pertence ao pedido — fica de fora da conta
  }
  for (const [id, qty] of net) if (qty <= 0) net.delete(id);
  return net;
}

/**
 * Devolve ao estoque exatamente o que o pedido segurou, com movimento de
 * ENTRADA registrado. Idempotente por construção: rodou duas vezes, a
 * segunda encontra líquido zero e não devolve nada.
 */
export async function devolverEstoqueDoPedido(
  tx: TxComMovimentos,
  args: { companyId: string; orderId: string; motivo: string }
): Promise<{ variantId: string; quantity: number }[]> {
  const liquido = await baixasLiquidasDoPedido(tx, args.orderId);
  const devolvidas = [...liquido.entries()].map(([variantId, quantity]) => ({
    variantId,
    quantity,
  }));
  for (const d of devolvidas) {
    await tx.productVariant.updateMany({
      where: { id: d.variantId },
      data: { stock: { increment: d.quantity } },
    });
  }
  if (devolvidas.length > 0) {
    await tx.inventoryMovement.createMany({
      data: devolvidas.map((d) => ({
        companyId: args.companyId,
        variantId: d.variantId,
        orderId: args.orderId,
        type: "ENTRADA" as const,
        quantity: d.quantity,
        reason: args.motivo,
      })),
    });
  }
  return devolvidas;
}
