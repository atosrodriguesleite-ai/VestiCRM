import type { Prisma } from "@prisma/client";

/**
 * "Esconder os sem estoque" × "vende sob encomenda" (RN-076): a loja que
 * esconde a peça zerada do catálogo NÃO esconde a que vende sob encomenda —
 * ela zera (e fica negativa) de propósito, e sumir da vitrine é exatamente o
 * contrário do que a chavinha promete. A peça entra quando tem estoque, OU
 * está ligada na ficha, OU segue uma categoria ligada (a ficha não a
 * desligou). É a escada peça > categoria escrita como filtro do banco; a
 * exceção da peça vinculada (Nuvemshop/Jueri) é decidida depois, por
 * variação, pela regra pura — aqui o produto só deixa de ser escondido.
 */
export function ondeNaoEscondePorEstoque(
  categoriasSobEncomenda: ReadonlySet<string>
): Prisma.ProductWhereInput {
  const cats = [...categoriasSobEncomenda];
  // a chavinha só alcança a peça que NÃO é de dono externo (RN-050): produto
  // do Jueri, ou cujas variações estão todas na Nuvemshop, segue escondido
  // quando zera — senão ele era lido e serializado na página (o peso da
  // RN-070) para o navegador esconder o card depois (achado da revisão)
  const podeSerLivre = { jueriId: null, variants: { some: { nuvemshopId: null } } };
  return {
    OR: [
      { variants: { some: { stock: { gt: 0 } } } },
      { sobEncomenda: true, ...podeSerLivre },
      ...(cats.length ? [{ sobEncomenda: null, category: { in: cats }, ...podeSerLivre }] : []),
    ],
  };
}
