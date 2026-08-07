import type { Prisma } from "@prisma/client";
import { baixasLiquidasDoPedido } from "./estoque-do-pedido";

/**
 * Apaga um pedido desfazendo TODO o efeito dele — como se nunca tivesse
 * existido: devolve o estoque (se estava baixado), tira a venda do
 * faturamento e limpa o histórico de estoque. Recebe uma transação para
 * que a operação seja atômica. NÃO mexe na oportunidade ligada (quem
 * chama decide, para não entrar em laço).
 *
 * Também remove o cliente que existia SÓ por causa deste pedido: quando o
 * cliente veio do catálogo e não sobra nenhum outro pedido dele, ele é
 * apagado junto (o que, em cascata, limpa tarefas, follow-ups, oportunidades,
 * conversas e eventos — some do dashboard, de "sem contato", etc.). Além
 * disso, os dados de navegação (visitas/cliques/funil) desse cliente saem
 * dos relatórios e da Inteligência. Clientes cadastrados manualmente em
 * Relacionamentos NUNCA são apagados por aqui.
 */
export async function reverseAndDeleteOrder(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    companyId: string;
    customerId: string;
    stockDeducted: boolean;
    items: { variantId: string | null; quantity: number }[];
  }
): Promise<{ devolvidas: { variantId: string; quantity: number }[] }> {
  // Devolve EXATAMENTE o que o pedido segurou (livro de movimentos: saiu −
  // voltou, por variação). Antes devolvia a quantidade do ITEM: reserva
  // parcial do catálogo e item religado a outra peça criavam estoque
  // fantasma na exclusão (auditoria 05/08/2026).
  const liquido = await baixasLiquidasDoPedido(tx, order.id);
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
  // A venda sai do faturamento e o histórico de estoque some.
  await tx.sale.deleteMany({ where: { orderId: order.id } });
  await tx.inventoryMovement.deleteMany({ where: { orderId: order.id } });
  // Apaga o pedido; itens/pagamentos/envio/eventos caem por cascata.
  await tx.order.delete({ where: { id: order.id } });

  // Limpa o cliente que só existia por causa deste pedido (veio do catálogo
  // e não tem mais nenhum pedido). Isso zera as métricas de clientes.
  await cleanupOrphanCatalogCustomer(tx, order.companyId, order.customerId);
  return { devolvidas };
}

/**
 * Se o cliente veio do catálogo público e não tem mais nenhum pedido, ele é
 * apagado (cascata limpa tarefas, oportunidades, conversas, vendas e eventos)
 * e os dados de navegação dele saem do tracking. Seguro: só age em clientes
 * de origem CATALOGO_PUBLICO sem outros pedidos.
 */
export async function cleanupOrphanCatalogCustomer(
  tx: Prisma.TransactionClient,
  companyId: string,
  customerId: string
) {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, companyId },
    select: { id: true, origin: true },
  });
  if (!customer || customer.origin !== "CATALOGO_PUBLICO") return;

  const remainingOrders = await tx.order.count({ where: { customerId } });
  if (remainingOrders > 0) return;

  // Conversa de WhatsApp com mensagens é HISTÓRICO REAL da loja: apagar o
  // cliente cascatearia a conversa inteira. Cliente que já conversou fica —
  // só o pedido some (auditoria 05/08/2026).
  const temConversa = await tx.conversation.findFirst({
    where: { customerId, messages: { some: {} } },
    select: { id: true },
  });
  if (temConversa) return;

  // Navegação do cliente (visitas/cliques/funil) sai dos relatórios e da
  // Inteligência. Deletar as sessões cascateia os eventos.
  await tx.trackSession.deleteMany({ where: { companyId, customerId } });
  await tx.visitor.deleteMany({ where: { companyId, customerId } });

  // O cliente sai de vez; em cascata limpa tarefas, oportunidades, conversas,
  // vendas e eventos ligados a ele.
  await tx.customer.delete({ where: { id: customerId } });
}
