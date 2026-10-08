/**
 * O LIVRO DE CRÉDITO DA CLIENTE × A TROCA (RN-073).
 *
 * Arquivo separado do registrador de propósito: quem cancela e quem apaga
 * pedido (`route.ts` e `order-actions.ts`) chama daqui, e o registrador
 * importa o espelho da Nuvemshop — juntar tudo num arquivo só criaria um
 * ciclo de import.
 */
import type { Prisma } from "@prisma/client";
import { round2, type OrderTotals } from "@/lib/orders";
import { saldoDeCredito } from "./regra";

/** origens do livro de crédito que a troca escreve */
export const ORIGEM_CREDITO_TROCA = "TROCA";
export const ORIGEM_CREDITO_TROCA_ESTORNO = "TROCA_ESTORNO";
export const ORIGEM_CREDITO_TROCA_REPOSICAO = "TROCA_REPOSICAO";
/** RN-074: o crédito USADO num pedido (negativo) e o que volta dele (positivo) */
export const ORIGEM_CREDITO_PEDIDO = "PEDIDO";
export const ORIGEM_CREDITO_PEDIDO_ESTORNO = "PEDIDO_ESTORNO";

/**
 * Fila por CLIENTE no livro de crédito (RN-074): duas abas usando o mesmo
 * crédito em dois pedidos, ou o cancelamento estornando enquanto outro
 * pedido usa, leriam o mesmo saldo e o gastariam duas vezes. Toda escrita
 * no livro passa por aqui antes de ler o saldo.
 */
export async function travarCreditoDaCliente(tx: Prisma.TransactionClient, customerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credito:" + customerId}))`;
}

/** O saldo da cliente HOJE: a soma do livro (nunca um número guardado). */
export async function saldoDaCliente(tx: Prisma.TransactionClient, companyId: string, customerId: string): Promise<number> {
  const r = await tx.customerCredit.aggregate({ where: { companyId, customerId }, _sum: { valor: true } });
  return round2(r._sum.valor ?? 0);
}

/**
 * RN-074 · Os totais NOVOS de um pedido (edição de itens ou de valores)
 * com o crédito de troca RELIDO sob a trava do pedido — usar o número lido
 * antes da transação deixava a edição gravar por cima de um "Usar crédito"
 * que entrou no meio, e a cliente perdia o crédito que já tinha saído do
 * livro (achado da revisão). `totais` vem SEM crédito; o que não couber no
 * valor novo volta para a ficha.
 */
export async function aplicarCreditoAtual(
  tx: Prisma.TransactionClient,
  entrada: { companyId: string; orderId: string; numeroDoPedido: string; autorNome: string; totais: OrderTotals }
): Promise<OrderTotals> {
  const atual = await tx.order.findUnique({
    where: { id: entrada.orderId },
    select: { creditoTroca: true, customerId: true },
  });
  const tinha = round2(atual?.creditoTroca ?? 0);
  const t = entrada.totais;
  const credito = round2(Math.max(0, Math.min(tinha, t.netTotal)));
  const netTotal = round2(t.netTotal - credito);
  if (atual && credito < tinha - 0.005) {
    await travarCreditoDaCliente(tx, atual.customerId);
    await devolverCreditoDoPedido(tx, {
      companyId: entrada.companyId,
      customerId: atual.customerId,
      orderId: entrada.orderId,
      numeroDoPedido: entrada.numeroDoPedido,
      valor: tinha - credito,
      autorNome: entrada.autorNome,
      motivo: "ficou menor que o crédito",
    });
  }
  return { ...t, credito, netTotal, total: round2(netTotal + t.shippingFee) };
}

/**
 * O PEDIDO QUE USOU CRÉDITO SAIU DO AR (cancelado, apagado) ou ficou menor
 * que o crédito: o que ele tinha usado VOLTA para o livro da cliente.
 * `valor` é quanto devolver; zero ou negativo não faz nada.
 */
export async function devolverCreditoDoPedido(
  tx: Prisma.TransactionClient,
  entrada: { companyId: string; customerId: string; orderId: string; numeroDoPedido: string; valor: number; autorNome: string; motivo: string }
): Promise<number> {
  const valor = round2(entrada.valor);
  if (!(valor > 0.005)) return 0;
  await tx.customerCredit.create({
    data: {
      companyId: entrada.companyId,
      customerId: entrada.customerId,
      valor,
      origem: ORIGEM_CREDITO_PEDIDO_ESTORNO,
      origemId: entrada.orderId,
      descricao: `Crédito devolvido à ficha — pedido ${entrada.numeroDoPedido} ${entrada.motivo}`,
      criadoPorNome: entrada.autorNome,
    },
  });
  return valor;
}

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
  // RN-074: o crédito pode JÁ TER SIDO USADO em outro pedido. Estornar o que
  // a troca deu sem olhar o saldo deixaria a ficha NEGATIVA — a loja passaria
  // a "cobrar" da cliente por um livro. Estorna-se no máximo o saldo de hoje,
  // e o que já tinha sido usado é DITO na história para alguém conferir.
  let jaUsado = 0;
  const clientes = [...new Set(trocas.map((t) => t.customerId))];
  for (const c of clientes) await travarCreditoDaCliente(tx, c);
  const saldoPorCliente = new Map<string, number>();
  for (const c of clientes) saldoPorCliente.set(c, await saldoDaCliente(tx, entrada.companyId, c));
  for (const t of trocas) {
    if (t.resolucao !== "CREDITO") continue;
    const vigenteDaTroca = await creditoVigenteDaTroca(tx, entrada.companyId, t.id);
    if (vigenteDaTroca <= 0.005) continue;
    const saldo = saldoPorCliente.get(t.customerId) ?? 0;
    const vigente = round2(Math.max(0, Math.min(vigenteDaTroca, saldo)));
    const usadoDestaTroca = round2(vigenteDaTroca - vigente);
    if (usadoDestaTroca > 0.005) {
      // o que já foi usado é abatido na devolução do pedido — e fica
      // ANOTADO na troca, senão o crédito "vigente" dela reaparecia e um
      // cancelamento/exclusão seguinte estornaria de novo (achado da revisão)
      jaUsado = round2(jaUsado + usadoDestaTroca);
      await tx.troca.update({
        where: { id: t.id },
        data: { creditoAbatidoNaDevolucao: { increment: usadoDestaTroca } },
      });
    }
    if (vigente <= 0.005) continue;
    saldoPorCliente.set(t.customerId, round2(saldo - vigente));
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
  if (entrada.motivo === "cancelado" && (estornado > 0 || jaUsado > 0 || pendentes.length > 0 || acertadas.length > 0)) {
    const partes: string[] = [];
    if (estornado > 0) partes.push(`crédito de troca de ${brlTexto(estornado)} estornado da ficha da cliente`);
    if (jaUsado > 0)
      partes.push(`${brlTexto(jaUsado)} do crédito da troca já tinha sido usado em outro pedido — abater da devolução do pedido`);
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
  for (const c of new Set(trocas.map((t) => t.customerId))) await travarCreditoDaCliente(tx, c);
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

/**
 * O que do crédito DAQUELA troca ainda está vigente: concessão − estornos +
 * reposições no livro, menos a parte abatida na devolução de um pedido
 * cancelado (RN-074 — essa não está no livro porque já tinha sido usada).
 */
async function creditoVigenteDaTroca(tx: Prisma.TransactionClient, companyId: string, trocaId: string): Promise<number> {
  const troca = await tx.troca.findUnique({ where: { id: trocaId }, select: { creditoAbatidoNaDevolucao: true } });
  return round2((await somaDoLivroDaTroca(tx, companyId, trocaId)) - (troca?.creditoAbatidoNaDevolucao ?? 0));
}

async function somaDoLivroDaTroca(tx: Prisma.TransactionClient, companyId: string, trocaId: string): Promise<number> {
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
