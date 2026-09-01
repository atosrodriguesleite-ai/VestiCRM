import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { baixasLiquidasDoPedido } from "./estoque-do-pedido";
import { pushStockToNuvemshop } from "./nuvemshop";
import { pushStockToJueri } from "./jueri";

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
    stockWrittenOff: boolean;
    /** visita do catálogo que gerou este pedido (RN-040) */
    trackSessionId?: string | null;
    items: { variantId: string | null; quantity: number }[];
  }
): Promise<{ devolvidas: { variantId: string; quantity: number }[] }> {
  // Devolve EXATAMENTE o que o pedido segurou (livro de movimentos: saiu −
  // voltou, por variação). Antes devolvia a quantidade do ITEM: reserva
  // parcial do catálogo e item religado a outra peça criavam estoque
  // fantasma na exclusão (auditoria 05/08/2026).
  //
  // EXCEÇÃO — baixa definitiva (stockWrittenOff): o cancelamento decidiu que
  // as peças NÃO voltam (perda/brinde/defeito). Excluir o pedido não pode
  // ressuscitá-las: nada é devolvido, e os movimentos ficam (desvinculados)
  // como única explicação de por que o estoque está mais baixo.
  const liquido = order.stockWrittenOff
    ? new Map<string, number>()
    : await baixasLiquidasDoPedido(tx, order.id);
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
  if (order.stockWrittenOff) {
    await tx.inventoryMovement.updateMany({
      where: { orderId: order.id },
      data: { orderId: null },
    });
  } else {
    await tx.inventoryMovement.deleteMany({ where: { orderId: order.id } });
  }
  // Apaga o pedido; itens/pagamentos/envio/eventos caem por cascata.
  await tx.order.delete({ where: { id: order.id } });

  // A VISITA DEIXA DE CONTAR COMO VENDA (relato do dono, 01/09/2026: "fala
  // que tem um pedido, mas esse pedido não chegou aqui"). O pedido do
  // catálogo marca `TrackSession.converted` ao nascer, e apagar o pedido
  // NUNCA desmarcava: a campanha seguia anunciando uma venda que não existe
  // mais, o funil contava "enviou pedido" e — o pior — a recuperação parava
  // de procurar essa cliente, achando que ela já tinha comprado.
  //
  // Fica aqui, no funil ÚNICO de exclusão, para valer também quando o pedido
  // é apagado pelo funil de vendas. E só desmarca se NÃO sobrou nenhum outro
  // pedido daquela visita: duas sacolas na mesma sessão são raras, mas apagar
  // uma não pode apagar a prova da outra.
  if (order.trackSessionId) {
    const aindaTem = await tx.order.count({
      // companyId junto: é a convenção da RN-013 e é o que usa o índice
      // (companyId, trackSessionId) — sem ele a exclusão varria a tabela
      // inteira de pedidos dentro da transação
      where: { companyId: order.companyId, trackSessionId: order.trackSessionId },
    });
    if (aindaTem === 0) {
      // updateMany e não update: `Order.trackSessionId` não tem chave
      // estrangeira, então a sessão pode já ter sumido — e um P2025 aqui
      // abortaria a transação inteira, deixando o pedido impossível de
      // excluir. companyId junto pela RN-013 (revisão de 01/09/2026).
      await tx.trackSession.updateMany({
        where: { id: order.trackSessionId, companyId: order.companyId },
        data: { converted: false },
      });
    }
  }

  // Limpa o cliente que só existia por causa deste pedido (veio do catálogo
  // e não tem mais nenhum pedido). Isso zera as métricas de clientes.
  await cleanupOrphanCatalogCustomer(tx, order.companyId, order.customerId);
  return { devolvidas };
}

/**
 * Trava de exclusão: pedido com pagamento de gateway CONFIRMADO (dinheiro
 * real que entrou pelo Mercado Pago/InfinitePay) não pode ser apagado — a
 * cascata levaria o rastro do dinheiro junto (auditoria 07/08 e 11/08/2026).
 * Vale para TODA porta que apaga pedido (tela Pedidos e funil); antes cada
 * rota copiava a checagem e uma delas ficou sem (revisão 18/08/2026).
 */
export async function temPagamentoConfirmadoDeGateway(orderId: string) {
  const n = await db.payment.count({
    where: {
      orderId,
      provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] },
      status: "CONFIRMADO",
    },
  });
  return n > 0;
}

/**
 * Integrações donas de estoque precisam saber que as peças voltaram — sem
 * isso a Nuvemshop continuava vendendo com o número velho (RN-014). Roda
 * FORA da transação e nunca derruba a rota (o push tem retry próprio).
 */
export function avisarIntegracoesDaDevolucao(
  companyId: string,
  devolvidas: { variantId: string; quantity: number }[]
) {
  if (devolvidas.length === 0) return;
  pushStockToNuvemshop(
    companyId,
    devolvidas.map((d) => d.variantId)
  ).catch(() => {});
  pushStockToJueri(
    companyId,
    devolvidas.map((d) => ({ variantId: d.variantId, delta: d.quantity }))
  ).catch(() => {});
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
    select: {
      id: true,
      origin: true,
      notes: true,
      cpf: true,
      cnpj: true,
      birthDate: true,
      tags: { select: { tagId: true }, take: 1 },
      interests: { select: { interestId: true }, take: 1 },
    },
  });
  if (!customer || customer.origin !== "CATALOGO_PUBLICO") return;

  // ficha TRABALHADA À MÃO não é órfã: se alguém anotou, etiquetou, marcou
  // interesse ou documento, apagar jogaria fora trabalho da equipe
  // (auditoria 07/08/2026). A carteira (ownerId) fica de fora do critério:
  // ela é atribuída sozinha pelo rodízio, não é sinal de trabalho manual.
  const enriquecido =
    !!customer.notes ||
    !!customer.cpf ||
    !!customer.cnpj ||
    !!customer.birthDate ||
    customer.tags.length > 0 ||
    customer.interests.length > 0;
  if (enriquecido) return;

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
