/**
 * RN-074 · O CRÉDITO DA TROCA É USADO NUM PEDIDO NOVO.
 *
 * A troca deu à cliente um crédito (RN-073); aqui ele vira dinheiro: a
 * vendedora abre o pedido novo e toca "Usar crédito". O crédito sai do livro
 * da cliente (linha negativa, presa ao pedido) e REDUZ o valor vendido do
 * pedido — é desconto, não pagamento: os R$ 12 já tinham voltado para ela na
 * troca, e contá-los como pagamento faria a loja faturar (e pagar comissão)
 * sobre dinheiro que não entrou. Tirar o crédito devolve tudo ao livro.
 *
 * Fila por PEDIDO (a mesma da troca, da edição e do status) e por CLIENTE
 * (o livro dela): duas abas não gastam o mesmo crédito duas vezes.
 */
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { orderNumber, round2 } from "@/lib/orders";
import { travarPedido } from "@/lib/etiquetas/separacao";
import { sincronizarPedidoSemQuebrar } from "@/lib/financeiro/porta-vendas";
import { syncOpportunityValue } from "@/lib/opportunity-sync";
import { creditoAUsar, recusaDoCredito } from "./regra";
import {
  ORIGEM_CREDITO_PEDIDO,
  devolverCreditoDoPedido,
  saldoDaCliente,
  travarCreditoDaCliente,
} from "./credito";
import type { Prisma } from "@prisma/client";

export type ResultadoDoCredito =
  | { ok: true; abatido: number }
  | { ok: false; erro: string; status: 403 | 404 | 409 };

class Recusa extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
  }
}

const brlTexto = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/** A cobrança acompanha o que a cliente paga — a mesma régua da edição de valores. */
async function acompanharCobranca(tx: Prisma.TransactionClient, orderId: string, total: number, netTotal: number) {
  await tx.payment.updateMany({ where: { orderId, status: "PENDENTE" }, data: { amount: total } });
  // o Pix/link do valor antigo expira: pago depois, cobraria o valor velho
  const expiradas = await tx.payment.updateMany({
    where: { orderId, status: "PENDENTE", provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] }, dueAt: { gt: new Date() } },
    data: { dueAt: new Date() },
  });
  // e a ficha DIZ — a mesma frase da edição de valores: a vendedora que já
  // mandou o Pix para a cliente precisa saber que tem que gerar outro
  if (expiradas.count > 0)
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "NOTA",
        description: "⚠️ O valor do pedido mudou: a cobrança Pix/cartão anterior foi invalidada — gere uma nova antes de enviar à cliente.",
      },
    });
  await tx.sale.updateMany({ where: { orderId }, data: { total: netTotal } });
}

export async function mexerNoCreditoDoPedido(
  user: SessionUser,
  orderId: string,
  acao: "usar" | "tirar"
): Promise<ResultadoDoCredito> {
  // a régua dos valores do pedido: suporte não mexe em dinheiro comercial
  if (user.role === "SUPPORT") return { ok: false, erro: "Usar crédito é da equipe comercial.", status: 403 };
  const visivel = await db.order.findFirst({ where: { id: orderId, ...orderScope(user) }, select: { id: true } });
  if (!visivel) return { ok: false, erro: "Pedido não encontrado.", status: 404 };

  try {
    let oportunidade: { id: string | null; netTotal: number } = { id: null, netTotal: 0 };
    const abatido = await db.$transaction(
      async (tx) => {
        await travarPedido(tx, orderId);
        const order = await tx.order.findFirst({ where: { id: orderId, companyId: user.companyId } });
        if (!order) throw new Recusa("Pedido não encontrado.", 404);
        const recusa = recusaDoCredito(order);
        if (recusa) throw new Recusa(recusa, 409);
        await travarCreditoDaCliente(tx, order.customerId);

        // o valor ANTES do crédito: produtos − desconto + acréscimo
        const antes = round2(order.netTotal + order.creditoTroca);
        let novoCredito: number;
        let mexido: number;
        if (acao === "usar") {
          const saldo = await saldoDaCliente(tx, user.companyId, order.customerId);
          mexido = creditoAUsar(saldo, antes, order.creditoTroca);
          if (!(mexido > 0.005))
            throw new Recusa(
              saldo <= 0.005 ? "A cliente não tem crédito de troca na ficha." : "O crédito já cobre o valor deste pedido.",
              409
            );
          novoCredito = round2(order.creditoTroca + mexido);
          await tx.customerCredit.create({
            data: {
              companyId: user.companyId,
              customerId: order.customerId,
              valor: -mexido,
              origem: ORIGEM_CREDITO_PEDIDO,
              origemId: order.id,
              descricao: `Usado no pedido ${orderNumber(order.number)}`,
              criadoPorNome: user.name,
            },
          });
        } else {
          mexido = order.creditoTroca;
          if (!(mexido > 0.005)) throw new Recusa("Este pedido não tem crédito abatido.", 409);
          novoCredito = 0;
          await devolverCreditoDoPedido(tx, {
            companyId: user.companyId,
            customerId: order.customerId,
            orderId: order.id,
            numeroDoPedido: orderNumber(order.number),
            valor: mexido,
            autorNome: user.name,
            motivo: "— crédito tirado do pedido",
          });
        }
        const netTotal = round2(antes - novoCredito);
        const total = round2(netTotal + order.shippingFee);
        await tx.order.update({ where: { id: order.id }, data: { creditoTroca: novoCredito, netTotal, total } });
        oportunidade = { id: order.opportunityId, netTotal };
        await acompanharCobranca(tx, order.id, total, netTotal);
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description:
              acao === "usar"
                ? `Crédito de troca de ${brlTexto(mexido)} abatido por ${user.name}. Valor vendido ${brlTexto(netTotal)} · total a pagar ${brlTexto(total)}.`
                : `Crédito de troca de ${brlTexto(mexido)} tirado do pedido por ${user.name} e devolvido à ficha da cliente. Valor vendido ${brlTexto(netTotal)} · total a pagar ${brlTexto(total)}.`,
            userId: user.id,
          },
        });
        return mexido;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    // o lançamento do financeiro acompanha o valor novo (RN-033)
    sincronizarPedidoSemQuebrar(orderId);
    // o funil acompanha o VALOR VENDIDO, como na edição de valores
    await syncOpportunityValue(user.companyId, oportunidade.id, oportunidade.netTotal);
    return { ok: true, abatido };
  } catch (e) {
    if (e instanceof Recusa) return { ok: false, erro: e.message, status: e.status };
    throw e;
  }
}
