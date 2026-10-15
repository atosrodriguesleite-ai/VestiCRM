import type { Prisma } from "@prisma/client";

/**
 * "Esconder os sem estoque" × "vende sob encomenda" (RN-076): a loja que
 * esconde a peça zerada do catálogo NÃO esconde a que vende sob encomenda —
 * ela zera (e fica negativa) de propósito, e sumir da vitrine é exatamente o
 * contrário do que a chavinha promete. A peça entra quando tem estoque, OU
 * está ligada na ficha, OU segue uma categoria ligada (a ficha não a
 * desligou). É a escada peça > categoria escrita como filtro do banco; a
 * exceção do Jueri entra aqui também (ela é do produto).
 */
export function ondeNaoEscondePorEstoque(
  categoriasSobEncomenda: ReadonlySet<string>
): Prisma.ProductWhereInput {
  const cats = [...categoriasSobEncomenda];
  // a chavinha não alcança o produto do Jueri (a sync dele apagaria o
  // negativo): zerado, ele segue escondido — senão era lido e serializado na
  // página (o peso da RN-070) para o navegador esconder o card depois
  const podeSerLivre = { jueriId: null };
  return {
    OR: [
      { variants: { some: { stock: { gt: 0 } } } },
      { sobEncomenda: true, ...podeSerLivre },
      ...(cats.length ? [{ sobEncomenda: null, category: { in: cats }, ...podeSerLivre }] : []),
    ],
  };
}
