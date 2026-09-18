import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { DadosEtiqueta } from "./modelo";

/** Teto de etiquetas num pedido de impressão (um rolo; acima disso é dedo errado). */
export const TETO_ETIQUETAS_POR_LOTE = 500;

export type ItemDeImpressao = { variantId: string; quantidade: number };

/**
 * OS DADOS DE CADA PEÇA A IMPRIMIR, recortados pela loja (RN-013).
 *
 * A tela manda só (variação, quantidade); quem monta o texto da etiqueta é o
 * servidor, do cadastro — a tela nunca manda nome nem preço prontos. Variação
 * de OUTRA loja (ou apagada) não vem: o pedido é recusado com a lista do que
 * não foi achado, em vez de imprimir metade calado.
 */
export async function dadosParaImprimir(
  companyId: string,
  itens: ItemDeImpressao[]
): Promise<
  | { ok: true; lote: { dados: DadosEtiqueta; quantidade: number }[]; total: number }
  | { ok: false; erro: string; faltando?: string[] }
> {
  const total = itens.reduce((s, i) => s + i.quantidade, 0);
  if (total <= 0) return { ok: false, erro: "Escolha ao menos uma etiqueta para imprimir." };
  if (total > TETO_ETIQUETAS_POR_LOTE) {
    return { ok: false, erro: `Máximo de ${TETO_ETIQUETAS_POR_LOTE} etiquetas por vez (você pediu ${total}).` };
  }
  const ids = [...new Set(itens.map((i) => i.variantId))];
  const [loja, variacoes] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    db.productVariant.findMany({
      where: { id: { in: ids }, product: { companyId } },
      select: {
        id: true,
        color: true,
        size: true,
        sku: true,
        barcode: true,
        product: { select: { name: true, sku: true, category: true, wholesalePrice: true, retailPrice: true } },
      },
    }),
  ]);
  const porId = new Map(variacoes.map((v) => [v.id, v]));
  const faltando = ids.filter((id) => !porId.has(id));
  if (faltando.length > 0) {
    // devolve QUAIS: o modal marca as linhas, em vez de a lojista adivinhar
    // entre doze qual peça foi apagada (achado da revisão)
    return {
      ok: false,
      erro: `${faltando.length} peça(s) não existe(m) mais no cadastro da loja — tire da lista e tente de novo.`,
      faltando,
    };
  }
  const semCodigo = variacoes.filter((v) => !v.barcode);
  if (semCodigo.length > 0) {
    // não acontece depois da migração (o banco carimba toda variação no
    // INSERT). Se acontecer (linha inserida com o gatilho fora, ADR-017), o
    // conserto é DAR o código — só onde está nulo, pela mesma função do
    // banco; código existente nunca é reescrito (RN-059)
    await db.$executeRaw`UPDATE "ProductVariant" SET "barcode" = ean13_interno(nextval('"ProductVariant_barcode_seq"')) WHERE "id" IN (${Prisma.join(semCodigo.map((v) => v.id))}) AND "barcode" IS NULL`;
    const consertadas = await db.productVariant.findMany({
      where: { id: { in: semCodigo.map((v) => v.id) }, product: { companyId } },
      select: { id: true, barcode: true },
    });
    for (const c of consertadas) {
      const v = porId.get(c.id);
      if (v) v.barcode = c.barcode;
    }
    if (consertadas.some((c) => !c.barcode)) {
      return { ok: false, erro: "Uma das peças ficou sem código de barras e o sistema não conseguiu gerar. Avise o suporte." };
    }
  }
  const lote = itens
    .filter((i) => i.quantidade > 0)
    .map((i) => {
      const v = porId.get(i.variantId)!;
      return {
        quantidade: i.quantidade,
        dados: {
          loja: loja?.name ?? "",
          produto: v.product.name,
          cor: v.color,
          tamanho: v.size,
          sku: v.sku?.trim() || v.product.sku,
          codigo: v.barcode!,
          categoria: v.product.category,
          precoAtacado: v.product.wholesalePrice,
          precoVarejo: v.product.retailPrice,
        } satisfies DadosEtiqueta,
      };
    });
  return { ok: true, lote, total };
}
