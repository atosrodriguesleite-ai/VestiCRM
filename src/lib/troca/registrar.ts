/**
 * TROCA DE PEÇAS — A PORTA QUE GRAVA (RN-073).
 *
 * Uma transação só: estoque (livro de movimentos, reserva condicional da
 * peça que sai — RN-003), a troca com os retratos das peças, o crédito da
 * cliente quando a resolução é crédito e a história do pedido. Depois do
 * commit, o espelho do estoque para a Nuvemshop (RN-053) e o Jueri — a
 * troca é um movimento REAL, como a venda.
 *
 * O pedido original NÃO é tocado: nem valor, nem status, nem data, nem
 * vendedora, nem o carimbo da separação. É a decisão central da regra
 * (ADR-018). A troca pressupõe que a peça JÁ SAIU com a cliente (pedido
 * enviado/entregue) — pedido que ainda consta na loja é recusado.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { orderNumber, round2 } from "@/lib/orders";
import { reservarEstoque, textoDaFalta } from "@/lib/reservations";
import { travarPedido } from "@/lib/etiquetas/separacao";
import { espelharEstoqueSemQuebrar } from "@/lib/nuvemshop";
import { espelharJueriSemQuebrar } from "@/lib/jueri";
import { registrarAcertoDaTrocaSemQuebrar } from "@/lib/financeiro/porta-vendas";
import {
  RECUSA_TROCA_POR_STATUS,
  aceitaTroca,
  deltasPorVariacao,
  juntarSaidas,
  juntarVoltas,
  linhasParaTroca,
  movimentosDaTroca,
  nasceAcertada,
  resolucaoValida,
  rotuloDaPeca,
  somarTroca,
  textoDaTroca,
  textoDoAcerto,
  validarTroca,
  type PecaQueSai,
  type PecaQueVolta,
  type TrocaResolucao,
} from "./regra";
import { ORIGEM_CREDITO_TROCA } from "./credito";

export type EntradaDaTroca = {
  volta: PecaQueVolta[];
  sai: PecaQueSai[];
  resolucao: TrocaResolucao;
  motivo?: string | null;
  freteCombinado?: string | null;
  observacoes?: string | null;
};

export type ResultadoDaTroca =
  | { ok: true; trocaId: string; numero: number }
  | { ok: false; erro: string; status: 400 | 403 | 404 | 409 };

class RecusaDaTroca extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}


/**
 * Quem registra: a equipe comercial (a vendedora registra — decisão do
 * dono). Suporte fica fora: a troca mexe em dinheiro (diferença, crédito),
 * a mesma régua dos valores do pedido.
 */
export function podeRegistrarTroca(user: Pick<SessionUser, "role">): boolean {
  return user.role !== "SUPPORT";
}

export async function registrarTroca(
  user: SessionUser,
  orderId: string,
  entrada: EntradaDaTroca
): Promise<ResultadoDaTroca> {
  if (!podeRegistrarTroca(user))
    return { ok: false, erro: "Registrar troca é da equipe comercial.", status: 403 };

  const volta = juntarVoltas(entrada.volta);
  const sai = juntarSaidas(entrada.sai);

  // fora da transação só o recorte (RN-007/RN-013): tudo que decide é relido
  // lá dentro, sob a trava do pedido
  const pedido = await db.order.findFirst({
    where: { id: orderId, ...orderScope(user) },
    select: { id: true },
  });
  if (!pedido) return { ok: false, erro: "Pedido não encontrado.", status: 404 };

  let efeitos: { variantId: string; delta: number }[] = [];
  let variantIds: string[] = [];

  try {
    const criada = await db.$transaction(
      async (tx) => {
        // duas trocas do mesmo pedido ao mesmo tempo (duas abas, dois
        // cliques) entram em fila: a segunda relê o que a primeira devolveu.
        // É a MESMA trava da edição de itens e do cancelamento? Não — mas a
        // reserva da peça que sai é condicional e o teto é relido aqui.
        await travarPedido(tx, orderId);

        const order = await tx.order.findFirst({
          where: { id: orderId, companyId: user.companyId },
          include: {
            items: true,
            trocas: {
              include: {
                itens: { select: { sentido: true, variantId: true, name: true, color: true, size: true, unitPrice: true, quantity: true } },
              },
            },
          },
        });
        if (!order) throw new RecusaDaTroca("Pedido não encontrado.", 404);
        if (!aceitaTroca(order.status)) throw new RecusaDaTroca(RECUSA_TROCA_POR_STATUS, 409);

        const linhas = linhasParaTroca(order.items, order.trocas);
        const erro = validarTroca(linhas, volta, sai);
        if (erro) throw new RecusaDaTroca(erro, 400);

        // as peças que saem: da MESMA loja (RN-013), com o retrato de agora
        const variacoes = await tx.productVariant.findMany({
          where: { id: { in: sai.map((s) => s.variantId) }, product: { companyId: user.companyId } },
          select: {
            id: true,
            color: true,
            size: true,
            sku: true,
            productId: true,
            product: { select: { name: true, sku: true, active: true } },
          },
        });
        const porVariacao = new Map(variacoes.map((v) => [v.id, v]));
        for (const s of sai) {
          const v = porVariacao.get(s.variantId);
          if (!v) throw new RecusaDaTroca("Uma das peças que saem não está mais no catálogo.", 400);
          if (!v.product.active)
            throw new RecusaDaTroca(`${v.product.name} está inativa no catálogo — reative a peça ou escolha outra.`, 409);
        }

        const totais = somarTroca(linhas, volta, sai);
        if (!resolucaoValida(totais.diferenca, entrada.resolucao))
          throw new RecusaDaTroca("A forma de acertar a diferença não combina com o valor dela — confira e tente de novo.", 400);

        const numero = order.trocas.length + 1;
        const pedidoRotulo = orderNumber(order.number);
        // o estoque DESTE pedido é daqui? (a venda da loja online baixou lá;
        // o livro daqui nunca teve a SAÍDA dela)
        const estoqueDoPedidoEDaqui = order.stockDeducted && !order.nuvemshopId;
        const movs = movimentosDaTroca(linhas, volta, sai, { numeroDaTroca: numero, pedido: pedidoRotulo, estoqueDoPedidoEDaqui });

        // 1) a peça que VOLTA boa sobe o estoque (defeito não) — ANTES da
        //    saída: a cliente que devolve a peça com defeito e leva outra da
        //    mesma cor × tamanho precisa de outra na arara, mas a que volta
        //    boa e sai de novo (raro) não deve bater em "sem estoque"
        for (const mv of movs) {
          if (mv.type === "ENTRADA" && mv.deltaEstoque > 0) {
            await tx.productVariant.update({
              where: { id: mv.variantId },
              data: { stock: { increment: mv.deltaEstoque } },
            });
          }
        }

        // 2) a peça que SAI é reservada de forma CONDICIONAL (RN-003): nunca
        //    negativa, nunca a mesma peça para duas clientes — faltou, a
        //    transação inteira volta atrás (a entrada acima inclusive)
        const faltas = await reservarEstoque(
          tx,
          sai.map((s) => {
            const v = porVariacao.get(s.variantId)!;
            return { variantId: s.variantId, quantity: s.quantity, label: rotuloDaPeca({ name: v.product.name, color: v.color, size: v.size }) };
          })
        );
        if (faltas.length > 0) throw new RecusaDaTroca(textoDaFalta(faltas), 409);

        // 3) o livro conta tudo: entrada, baixa por defeito e saída
        await tx.inventoryMovement.createMany({
          data: movs.map((mv) => ({
            companyId: user.companyId,
            variantId: mv.variantId,
            orderId: mv.comPedido ? order.id : null,
            type: mv.type,
            quantity: mv.quantity,
            reason: mv.reason,
          })),
        });

        // 4) a troca, com os retratos (a peça pode mudar depois)
        const porChave = new Map(linhas.map((l) => [l.chave, l]));
        const troca = await tx.troca.create({
          data: {
            companyId: user.companyId,
            orderId: order.id,
            customerId: order.customerId,
            numero,
            registradaPorId: user.id,
            registradaPorNome: user.name,
            motivo: entrada.motivo?.trim() || null,
            freteCombinado: entrada.freteCombinado?.trim() || null,
            observacoes: entrada.observacoes?.trim() || null,
            valorVolta: totais.valorVolta,
            valorSai: totais.valorSai,
            diferenca: totais.diferenca,
            resolucao: entrada.resolucao,
            resolvidaEm: nasceAcertada(entrada.resolucao) ? new Date() : null,
            resolvidaPorNome: nasceAcertada(entrada.resolucao) ? user.name : null,
            itens: {
              create: [
                ...volta.map((v) => {
                  const l = porChave.get(v.chave)!;
                  return {
                    sentido: "VOLTA" as const,
                    orderItemId: l.orderItemId,
                    productId: l.productId,
                    variantId: l.variantId,
                    name: l.name,
                    color: l.color,
                    size: l.size,
                    quantity: v.quantity,
                    unitPrice: l.unitPrice,
                    total: round2(l.unitPrice * v.quantity),
                    destino: v.destino,
                  };
                }),
                ...sai.map((s) => {
                  const v = porVariacao.get(s.variantId)!;
                  return {
                    sentido: "SAI" as const,
                    productId: v.productId,
                    variantId: v.id,
                    name: v.product.name,
                    sku: v.sku ?? v.product.sku,
                    color: v.color,
                    size: v.size,
                    quantity: s.quantity,
                    unitPrice: s.unitPrice,
                    total: round2(s.unitPrice * s.quantity),
                  };
                }),
              ],
            },
          },
          select: { id: true, numero: true },
        });

        // 5) crédito na ficha: uma linha POSITIVA no livro de crédito
        if (entrada.resolucao === "CREDITO") {
          await tx.customerCredit.create({
            data: {
              companyId: user.companyId,
              customerId: order.customerId,
              valor: -totais.diferenca,
              origem: ORIGEM_CREDITO_TROCA,
              origemId: troca.id,
              descricao: `Troca ${numero} do pedido ${pedidoRotulo}`,
              criadoPorNome: user.name,
            },
          });
        }

        // 6) a história do pedido — o "registro de trocas como histórico"
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: "NOTA",
            description: textoDaTroca({
              numero,
              autor: user.name,
              volta: volta.map((v) => ({ nome: rotuloDaPeca(porChave.get(v.chave)!), quantity: v.quantity, destino: v.destino })),
              sai: sai.map((s) => {
                const v = porVariacao.get(s.variantId)!;
                return { nome: rotuloDaPeca({ name: v.product.name, color: v.color, size: v.size }), quantity: s.quantity };
              }),
              diferenca: totais.diferenca,
              resolucao: entrada.resolucao,
              freteCombinado: entrada.freteCombinado,
              motivo: entrada.motivo,
            }),
            userId: user.id,
          },
        });

        efeitos = deltasPorVariacao(movs);
        variantIds = [...new Set(movs.map((m) => m.variantId))];
        return troca;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

    // ESPELHO fora da transação, depois do commit (RN-053/RN-057): a fila
    // garante que a Nuvemshop fica sabendo; o Jueri recebe o delta
    if (variantIds.length > 0) espelharEstoqueSemQuebrar(user.companyId, variantIds);
    if (efeitos.length > 0) espelharJueriSemQuebrar(user.companyId, efeitos);

    return { ok: true, trocaId: criada.id, numero: criada.numero };
  } catch (e) {
    if (e instanceof RecusaDaTroca) return { ok: false, erro: e.message, status: e.status };
    // duas trocas cruzaram apesar da trava (não deveria): o único (pedido,
    // número) segura, e a pessoa tenta de novo
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { ok: false, erro: "Outra troca deste pedido foi registrada agora mesmo — recarregue e confira.", status: 409 };
    throw e;
  }
}

/**
 * O DINHEIRO DA DIFERENÇA ANDOU: a cobrança foi recebida (por fora, Pix,
 * dinheiro) ou a devolução foi feita. Quem confirma é gente, e fica
 * registrado quem e quando — na troca e na história do pedido. Vale em
 * qualquer status do pedido (a cobrança pendente de um pedido depois
 * cancelado ainda precisa de onde ser registrada).
 */
export async function acertarTroca(
  user: SessionUser,
  orderId: string,
  trocaId: string
): Promise<ResultadoDaTroca> {
  if (!podeRegistrarTroca(user))
    return { ok: false, erro: "Confirmar o acerto é da equipe comercial.", status: 403 };

  const troca = await db.troca.findFirst({
    where: { id: trocaId, orderId, companyId: user.companyId, order: orderScope(user) },
    select: { id: true, numero: true, resolucao: true, diferenca: true, resolvidaEm: true },
  });
  if (!troca) return { ok: false, erro: "Troca não encontrada.", status: 404 };
  if (troca.resolucao !== "COBRAR" && troca.resolucao !== "DEVOLUCAO")
    return { ok: false, erro: "Esta troca não tem dinheiro para acertar.", status: 409 };
  if (troca.resolvidaEm) return { ok: true, trocaId: troca.id, numero: troca.numero }; // já estava: idempotente

  const acertouAgora = await db.$transaction(async (tx) => {
    // condicional: a outra aba que confirmou primeiro ganha, e a história
    // registra UM acerto — o evento só nasce quando a gravação pegou
    const gravou = await tx.troca.updateMany({
      where: { id: troca.id, resolvidaEm: null },
      data: { resolvidaEm: new Date(), resolvidaPorNome: user.name },
    });
    if (gravou.count === 0) return false;
    await tx.orderEvent.create({
      data: {
        orderId,
        type: "NOTA",
        description: textoDoAcerto({ numero: troca.numero, autor: user.name, resolucao: troca.resolucao, diferenca: troca.diferenca }),
        userId: user.id,
      },
    });
    return true;
  });
  // RN-074: o dinheiro que andou entra no financeiro pela porta única, já
  // baixado (loja sem o módulo: a porta sai calada)
  if (acertouAgora) registrarAcertoDaTrocaSemQuebrar(troca.id);
  return { ok: true, trocaId: troca.id, numero: troca.numero };
}
