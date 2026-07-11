import type { Prisma } from "@prisma/client";

/**
 * Apaga um pedido desfazendo TODO o efeito dele — como se nunca tivesse
 * existido: devolve o estoque (se estava baixado), tira a venda do
 * faturamento e limpa o histórico de estoque. Recebe uma transação para
 * que a operação seja atômica. NÃO mexe na oportunidade ligada (quem
 * chama decide, para não entrar em laço).
 */
export async function reverseAndDeleteOrder(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    stockDeducted: boolean;
    items: { variantId: string | null; quantity: number }[];
  }
) {
  // Estoque baixado (pedido pago) volta inteiro para o catálogo.
  if (order.stockDeducted) {
    for (const item of order.items) {
      if (!item.variantId) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      });
    }
  }
  // A venda sai do faturamento e o histórico de estoque some.
  await tx.sale.deleteMany({ where: { orderId: order.id } });
  await tx.inventoryMovement.deleteMany({ where: { orderId: order.id } });
  // Apaga o pedido; itens/pagamentos/envio/eventos caem por cascata.
  await tx.order.delete({ where: { id: order.id } });
}
