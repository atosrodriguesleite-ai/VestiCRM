import { db } from "./db";
import { orderNumber, PAID_ORDER_STATUSES } from "./orders";
import { notifySalePaid } from "./push";
import { pushStockToNuvemshop } from "./nuvemshop";
import { pushStockToJueri } from "./jueri";
import { winLinkedOpportunity } from "./opportunity-sync";
import { reservarOQueTiver, textoDaFalta } from "./reservations";

/**
 * Liquidação AUTOMÁTICA de pedido pago (Pix/cartão confirmado pelo gateway).
 * Espelha a transição manual para PAGO da tela de Pedidos: baixa/confirma o
 * estoque (com movimento), registra a venda (Sale), marca o pagamento,
 * atualiza o cliente e dispara o push 💰.
 *
 * Diferença IMPORTANTE do fluxo manual: aqui o dinheiro JÁ CAIU — nunca
 * recusamos a confirmação por falta de estoque. Se faltar peça, o pedido
 * vira PAGO mesmo assim e fica um aviso no histórico para a loja resolver.
 *
 * TRÊS BLINDAGENS (auditoria 05/08/2026):
 *  • TUDO numa transação com trava atômica no status — o gateway REENVIA o
 *    mesmo aviso (é o contrato dele) e antes dois avisos simultâneos criavam
 *    duas vendas e baixavam o estoque duas vezes;
 *  • baixa CONDICIONADA (reservarOQueTiver) — o estoque nunca fica negativo
 *    e o movimento gravado é o que SAIU de verdade (zerar negativos na mão
 *    quebrava a conta da devolução no cancelamento);
 *  • o VALOR PAGO é conferido contra o valor do pedido — a cliente que paga
 *    um QR antigo (pedido editado depois) não vira "pedido pago" sozinha.
 */

/** A trava pegou: o status mudou entre a leitura e a gravação. */
class CorridaNoSettle extends Error {}

export async function settleOrderPaid(
  orderId: string,
  origem: string, // ex.: "Pix (Mercado Pago)"
  /** valor que o gateway diz ter recebido (transaction_amount) */
  valorPago?: number
): Promise<{ ok: boolean; already?: boolean; valorDivergente?: boolean }> {
  // A trava de corrida derruba a tentativa inteira (rollback). Tentar de novo
  // uma vez resolve o caso real: o segundo aviso do gateway chegando junto —
  // na segunda ida o pedido já está PAGO e a resposta é "already".
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      return await liquidarUmaVez(orderId, origem, valorPago);
    } catch (e) {
      if (!(e instanceof CorridaNoSettle)) throw e;
    }
  }
  return { ok: false };
}

async function liquidarUmaVez(
  orderId: string,
  origem: string,
  valorPago?: number
): Promise<{ ok: boolean; already?: boolean; valorDivergente?: boolean }> {
  const agora = new Date();

  const resultado = await db.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) return { tipo: "sumiu" as const };

      // já pago (aviso repetido do gateway) → só garante o pagamento confirmado
      if ((PAID_ORDER_STATUSES as readonly string[]).includes(order.status)) {
        await tx.payment.updateMany({
          where: { orderId: order.id, status: "PENDENTE" },
          data: { status: "CONFIRMADO", paidAt: agora },
        });
        return { tipo: "ja-pago" as const };
      }
      if (order.status === "CANCELADO") {
        // pagamento de pedido cancelado: registra no histórico para a loja ver
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: `⚠️ Pagamento recebido via ${origem}, mas o pedido está CANCELADO — verifique (estorno ou reativação).`,
          },
        });
        return { tipo: "cancelado" as const };
      }

      // O valor pago tem que cobrir o pedido. `total` é a régua certa AQUI:
      // é o que a cliente paga (com frete) e foi por ele que o QR foi gerado.
      // Pagou menos = QR antigo de um pedido editado, ou cobrança adulterada —
      // o pedido NÃO vira pago sozinho; a loja decide olhando o aviso.
      if (valorPago != null && valorPago + 0.009 < order.total) {
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: `⚠️ Pagamento de R$ ${valorPago.toFixed(2)} recebido via ${origem}, mas o pedido custa R$ ${order.total.toFixed(2)}. O pedido NÃO foi marcado como pago — confira no Mercado Pago e finalize manualmente.`,
          },
        });
        return { tipo: "valor-divergente" as const };
      }

      // TRAVA ATÔMICA: só quem encontra o status que leu ganha a transição.
      // O concorrente (segundo aviso, ou a vendedora mexendo na mesma hora)
      // volta zero linhas e o rollback desfaz tudo desta tentativa.
      const trava = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        // paidAt = data do dinheiro (é por ela que o faturamento do mês soma)
        data: { status: "PAGO", stockDeducted: true, paidAt: agora },
      });
      if (trava.count === 0) throw new CorridaNoSettle();

      // ---- Estoque: baixa se ainda não estava reservado/baixado ----
      let seguradas: { variantId: string; quantity: number }[] = [];
      if (!order.stockDeducted) {
        const reserva = await reservarOQueTiver(
          tx,
          order.items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            label: `${i.name}${i.color || i.size ? ` (${[i.color, i.size].filter(Boolean).join(" ")})` : ""}`,
          }))
        );
        seguradas = reserva.seguradas;
        // movimento = o que SAIU de verdade (é dele que o cancelamento devolve)
        if (seguradas.length > 0) {
          await tx.inventoryMovement.createMany({
            data: seguradas.map((s) => ({
              companyId: order.companyId,
              variantId: s.variantId,
              orderId: order.id,
              type: "SAIDA" as const,
              quantity: s.quantity,
              reason: `Baixa por pagamento — pedido ${orderNumber(order.number)}`,
            })),
          });
        }
        if (reserva.faltas.length > 0) {
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              type: "NOTA",
              description: `⚠️ Pagamento confirmado com estoque insuficiente — ${textoDaFalta(reserva.faltas)}. Confira a disponibilidade antes de separar.`,
            },
          });
        }
      }

      await tx.payment.updateMany({
        where: { orderId: order.id, status: "PENDENTE" },
        data: { status: "CONFIRMADO", paidAt: agora },
      });
      await tx.sale.create({
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
      await tx.customer.update({
        where: { id: order.customerId },
        data: { lastPurchaseAt: agora, lastContactAt: agora },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "STATUS",
          description: `Status alterado para "Pago" automaticamente — pagamento confirmado via ${origem} ✅`,
        },
      });
      if (!order.sellerId) {
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description:
              'Pedido pago sem vendedor atribuído — atribua em "Editar dados" para contar na comissão.',
          },
        });
      }

      return {
        tipo: "liquidado" as const,
        seguradas,
        pedido: {
          id: order.id,
          number: order.number,
          companyId: order.companyId,
          customerId: order.customerId,
          opportunityId: order.opportunityId,
          total: order.total,
        },
      };
    },
    // pedido grande baixa estoque peça a peça: os 5s padrão não bastam com o
    // banco na nuvem (mesmo incidente "Transaction not found" da edição)
    { timeout: 30_000, maxWait: 10_000 }
  );

  if (resultado.tipo === "sumiu" || resultado.tipo === "cancelado")
    return { ok: false };
  if (resultado.tipo === "ja-pago") return { ok: true, already: true };
  if (resultado.tipo === "valor-divergente")
    return { ok: false, valorDivergente: true };

  const { pedido, seguradas } = resultado;

  // FUNIL acompanha: pedido pago → negociação ligada vira GANHA
  await winLinkedOpportunity(pedido.companyId, pedido.opportunityId);

  // integrações donas de estoque espelham a baixa (uma venda, uma baixa)
  if (seguradas.length > 0) {
    pushStockToNuvemshop(
      pedido.companyId,
      seguradas.map((s) => s.variantId)
    ).catch(() => {});
    pushStockToJueri(
      pedido.companyId,
      seguradas.map((s) => ({ variantId: s.variantId, delta: -s.quantity }))
    ).catch(() => {});
  }

  // 💰 o "ka-ching" no celular da loja
  const customer = await db.customer.findUnique({
    where: { id: pedido.customerId },
    select: { name: true },
  });
  notifySalePaid(pedido.companyId, {
    id: pedido.id,
    number: pedido.number,
    total: pedido.total,
    customerName: customer?.name ?? "Cliente",
  }).catch(() => {});

  return { ok: true };
}
