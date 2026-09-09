import type { Prisma } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import {
  decidirAjuste,
  donoDoEstoque,
  fraseDaRecusa,
  motivoDoLivro,
  rotuloDaPeca,
  type DonoExterno,
} from "./dono-do-estoque";

/**
 * A PORTA ÚNICA DO AJUSTE DIGITADO (RN-050).
 *
 * Todo estoque que uma PESSOA digita — no Inventário ou na tela Produtos —
 * passa por aqui. A porta confere a loja (RN-013), o papel (dito por quem
 * chama), o dono externo e
 * o motivo (`decidirAjuste`, pura), e grava as duas coisas JUNTAS: o número
 * novo na variação e a linha do livro de movimentos com quem, quando, motivo
 * e "(antes → depois)". Uma sem a outra é o que faz o histórico mentir.
 *
 * A gravação é CONDICIONAL ao número que a pessoa viu: duas pessoas
 * contando a mesma arara ao mesmo tempo, a segunda a salvar leva "o estoque
 * mudou enquanto você editava" em vez de sobrescrever a contagem da colega —
 * mesma régua da baixa condicionada da venda (RN-003).
 */

export type ResultadoDoAjuste =
  | { ok: true; mexeu: boolean; estoque: number; rotulo: string }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      error: string;
      dono?: DonoExterno;
      /** no conflito de contagem: o número que está no banco agora */
      estoqueAtual?: number;
    };

export type PedidoDeAjusteNaPorta = {
  user: SessionUser;
  /**
   * Quem decide o PAPEL é a porta que chama, porque as duas telas têm réguas
   * diferentes e as duas são de propósito: no Inventário ajusta gerência
   * (`podeAjustarEstoque`); na tela Produtos ajusta quem edita o produto —
   * como sempre foi, e mudar isso de carona trancaria a vendedora que cadastra
   * a grade. O que NÃO muda de porta para porta é o resto: loja, dono externo,
   * motivo, gravação condicional e a linha do livro.
   */
  podeAjustar: boolean;
  variantId: string;
  novoEstoque: number;
  /**
   * O número que a TELA mostrava quando a pessoa digitou. Se o banco já tem
   * outro (a colega contou primeiro, uma venda entrou), a porta recusa em
   * vez de gravar por cima — o Inventário manda sempre; a tela Produtos, que
   * salva a grade inteira, não manda (régua de sempre dela).
   */
  estoqueVisto?: number;
  motivo: string;
};

type TxDaPorta = Pick<Prisma.TransactionClient, "productVariant" | "inventoryMovement">;

/** A porta, DENTRO de uma transação que o chamador abriu. */
export async function ajustarEstoqueDentro(
  tx: TxDaPorta,
  p: PedidoDeAjusteNaPorta
): Promise<ResultadoDoAjuste> {
  const v = await tx.productVariant.findFirst({
    where: { id: p.variantId, product: { companyId: p.user.companyId } },
    select: {
      id: true,
      color: true,
      size: true,
      stock: true,
      nuvemshopId: true,
      product: { select: { name: true, jueriId: true } },
    },
  });
  if (!v) return { ok: false, status: 404, error: "Peça não encontrada" };
  const rotulo = rotuloDaPeca(v);
  if (p.estoqueVisto !== undefined && p.estoqueVisto !== v.stock && p.novoEstoque !== v.stock) {
    return {
      ok: false,
      status: 409,
      error: `O estoque de ${rotulo} mudou enquanto você editava (agora está em ${v.stock}). Confira o número e ajuste de novo.`,
      estoqueAtual: v.stock,
    };
  }
  const decisao = decidirAjuste({
    dono: donoDoEstoque(v),
    podeAjustar: p.podeAjustar,
    estoqueAtual: v.stock,
    novoEstoque: p.novoEstoque,
    motivo: p.motivo,
  });
  if (decisao.tipo === "RECUSADO") {
    const status =
      decisao.porque === "SEM_PERMISSAO" ? 403 : decisao.porque === "DONO_EXTERNO" ? 409 : 400;
    return { ok: false, status, error: fraseDaRecusa(decisao, rotulo), dono: decisao.dono };
  }
  if (decisao.tipo === "NADA") return { ok: true, mexeu: false, estoque: v.stock, rotulo };

  // condicional ao número que a pessoa VIU — contagem simultânea não se atropela
  const r = await tx.productVariant.updateMany({
    where: { id: v.id, stock: decisao.de },
    data: { stock: decisao.para },
  });
  if (r.count === 0) {
    return {
      ok: false,
      status: 409,
      error: `O estoque de ${rotulo} mudou enquanto você editava. Recarregue e confira o número.`,
    };
  }
  await tx.inventoryMovement.create({
    data: {
      companyId: p.user.companyId,
      variantId: v.id,
      type: "AJUSTE",
      quantity: decisao.quantidade,
      reason: motivoDoLivro(p.user.name, decisao),
    },
  });
  return { ok: true, mexeu: true, estoque: decisao.para, rotulo };
}

/** A porta com transação própria (uma peça por vez — é o gesto do Inventário). */
export async function ajustarEstoque(p: PedidoDeAjusteNaPorta): Promise<ResultadoDoAjuste> {
  return db.$transaction((tx) => ajustarEstoqueDentro(tx, p));
}
