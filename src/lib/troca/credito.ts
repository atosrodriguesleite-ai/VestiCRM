/**
 * O LIVRO DE CRÉDITO DA CLIENTE × A TROCA (RN-073).
 *
 * Arquivo separado do registrador de propósito: quem cancela e quem apaga
 * pedido (`route.ts` e `order-actions.ts`) chama daqui, e o registrador
 * importa o espelho da Nuvemshop — juntar tudo num arquivo só criaria um
 * ciclo de import.
 */
import type { Prisma } from "@prisma/client";
import { round2 } from "@/lib/orders";
import { saldoDeCredito } from "./regra";

/** origens do livro de crédito que a troca escreve */
export const ORIGEM_CREDITO_TROCA = "TROCA";
export const ORIGEM_CREDITO_TROCA_ESTORNO = "TROCA_ESTORNO";
export const ORIGEM_CREDITO_TROCA_REPOSICAO = "TROCA_REPOSICAO";

/**
 * O PEDIDO SAIU DO AR DEPOIS DA TROCA (cancelado ou apagado): o crédito que
 * a troca deu à cliente é ESTORNADO — a venda inteira está sendo desfeita e
 * devolvida (RN-004/RN-033), então manter os R$ 12 de crédito faria a loja
 * pagar duas vezes a mesma diferença (achado da revisão). E a cobrança ou
 * devolução ainda pendente fica DITA na história, para alguém conferir.
 *
 * Idempotente pelo saldo do livro daquela troca: só estorna o que está
 * vigente. Chamada DENTRO da transação de quem cancela/apaga.
 */
export async function desfazerCreditoDasTrocas(
  tx: Prisma.TransactionClient,
  entrada: { companyId: string; orderId: string; autorNome: string; motivo: "cancelado" | "apagado" }
): Promise<{ estornado: number; pendentes: number[] }> {
  const trocas = await tx.troca.findMany({
    where: { orderId: entrada.orderId, companyId: entrada.companyId },
    select: { id: true, numero: true, resolucao: true, resolvidaEm: true, customerId: true, diferenca: true },
  });
  if (trocas.length === 0) return { estornado: 0, pendentes: [] };
  let estornado = 0;
  for (const t of trocas) {
    if (t.resolucao !== "CREDITO") continue;
    const vigente = await creditoVigenteDaTroca(tx, entrada.companyId, t.id);
    if (vigente <= 0.005) continue;
    await tx.customerCredit.create({
      data: {
        companyId: entrada.companyId,
        customerId: t.customerId,
        valor: -vigente,
        origem: ORIGEM_CREDITO_TROCA_ESTORNO,
        origemId: t.id,
        descricao: `Estorno do crédito da troca ${t.numero} — pedido ${entrada.motivo}`,
        criadoPorNome: entrada.autorNome,
      },
    });
    estornado = round2(estornado + vigente);
  }
  const pendentes = trocas.filter((t) => !t.resolvidaEm && (t.resolucao === "COBRAR" || t.resolucao === "DEVOLUCAO")).map((t) => t.numero);
  // o dinheiro que JÁ ANDOU por fora nas trocas também precisa ser dito: a
  // devolução do pedido cancelado é do total do pedido, e os R$ 18 que a
  // cliente pagou a mais na troca (ou os R$ 10 que a loja já devolveu)
  // ficariam esquecidos (achado da revisão)
  const brlTexto = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
  const acertadas = trocas
    .filter((t) => t.resolvidaEm && (t.resolucao === "COBRAR" || t.resolucao === "DEVOLUCAO"))
    .map((t) =>
      t.resolucao === "COBRAR"
        ? `${brlTexto(t.diferenca)} recebido na troca ${t.numero} — devolver à cliente junto com o pedido`
        : `${brlTexto(-t.diferenca)} já devolvido na troca ${t.numero} — abater da devolução do pedido`
    );
  if (entrada.motivo === "cancelado" && (estornado > 0 || pendentes.length > 0 || acertadas.length > 0)) {
    const partes: string[] = [];
    if (estornado > 0) partes.push(`crédito de troca de ${brlTexto(estornado)} estornado da ficha da cliente`);
    if (pendentes.length > 0)
      partes.push(`${pendentes.length === 1 ? "a troca" : "as trocas"} ${pendentes.join(", ")} ${pendentes.length === 1 ? "tem" : "têm"} diferença ainda não acertada — confira com a cliente`);
    partes.push(...acertadas);
    await tx.orderEvent.create({
      data: { orderId: entrada.orderId, type: "NOTA", description: `Pedido cancelado com troca registrada: ${partes.join("; ")}.` },
    });
  }
  return { estornado, pendentes };
}

/**
 * O PEDIDO VOLTOU (cancelado → restaurado): o crédito estornado no
 * cancelamento volta a valer, pela mesma régua do saldo — a cliente que
 * ficou com a peça da troca volta a ter o crédito que a troca deu.
 */
export async function reporCreditoDasTrocas(
  tx: Prisma.TransactionClient,
  entrada: { companyId: string; orderId: string; autorNome: string }
): Promise<number> {
  const trocas = await tx.troca.findMany({
    where: { orderId: entrada.orderId, companyId: entrada.companyId, resolucao: "CREDITO" },
    select: { id: true, numero: true, customerId: true, diferenca: true },
  });
  let reposto = 0;
  for (const t of trocas) {
    const vigente = await creditoVigenteDaTroca(tx, entrada.companyId, t.id);
    const devido = round2(-t.diferenca);
    const falta = round2(devido - vigente);
    if (falta <= 0.005) continue;
    await tx.customerCredit.create({
      data: {
        companyId: entrada.companyId,
        customerId: t.customerId,
        valor: falta,
        origem: ORIGEM_CREDITO_TROCA_REPOSICAO,
        origemId: t.id,
        descricao: `Crédito da troca ${t.numero} reposto — pedido restaurado`,
        criadoPorNome: entrada.autorNome,
      },
    });
    reposto = round2(reposto + falta);
  }
  return reposto;
}

/** O que do crédito DAQUELA troca ainda está vigente no livro (concessão − estornos + reposições). */
async function creditoVigenteDaTroca(tx: Prisma.TransactionClient, companyId: string, trocaId: string): Promise<number> {
  const linhas = await tx.customerCredit.findMany({
    where: {
      companyId,
      origemId: trocaId,
      origem: { in: [ORIGEM_CREDITO_TROCA, ORIGEM_CREDITO_TROCA_ESTORNO, ORIGEM_CREDITO_TROCA_REPOSICAO] },
    },
    select: { valor: true },
  });
  return saldoDeCredito(linhas);
}
