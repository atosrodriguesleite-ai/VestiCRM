/**
 * O ACERVO DA VITRINE — a leitura do banco num lugar só (RN-094).
 *
 * Quais peças a cliente vê e por qual preço: a regra morava dentro do
 * componente de servidor da vitrine (`montar-catalogo.tsx`). O catálogo em
 * PDF precisa da MESMA lista — se ela fosse copiada, o dia em que a vitrine
 * mudar de regra (uma chavinha nova, um filtro novo) o PDF passaria a
 * mostrar peça que o site não mostra, ou o preço que a loja não cobra.
 *
 * Então a leitura mora aqui e os dois a chamam. O que muda entre eles é só o
 * que se faz com as fotos: a vitrine manda o ENDEREÇO (`/api/img/<id>`,
 * RN-070) e o PDF lê o conteúdo do banco para embutir no arquivo.
 */

import { db } from "@/lib/db";
import { catalogPrice } from "@/lib/orders";
import { ordenarVariantes } from "@/lib/tamanhos";
import { disponivelNaVitrine } from "@/lib/catalogo/teto-do-estoque";
import { vendeSobEncomenda } from "@/lib/sob-encomenda";
import { categoriasSobEncomenda } from "@/lib/sob-encomenda-data";
import { ondeNaoEscondePorEstoque } from "@/lib/catalogo/sob-encomenda-na-vitrine";
import { precoComDesconto } from "@/lib/catalogo/condicoes-da-campanha";
import { parseCategoryUnits, unidadeDaLoja, unidadeDaPeca, type Unidade } from "@/lib/catalogo/unidade";

/**
 * Uma peça como a vitrine a enxerga. As fotos vêm como **id**, não endereço:
 * quem chama decide se vira URL (tela) ou conteúdo (PDF).
 */
export type PecaDoAcervo = {
  id: string;
  name: string;
  sku: string;
  category: string;
  collection: string | null;
  description: string | null;
  retailPrice: number;
  wholesalePrice: number;
  /** o preço DESTA visita (tabela do link ou o padrão da loja), já com desconto */
  precoCatalogo: number;
  /** preço cheio, quando um desconto de campanha está valendo (vai riscado) */
  originalRetailPrice?: number;
  minQuantity: number;
  tags: string | null;
  /** "peça", "conjunto", "kit"… resolvida pela escada peça > categoria > loja (RN-068) */
  unidade: Unidade;
  images: { id: string; color: string | null }[];
  variants: { color: string; size: string; disponivel: number }[];
};

/** o que a leitura precisa saber da loja (o `Company` inteiro serve) */
export type LojaDoAcervo = {
  id: string;
  catalogHideOutOfStock: boolean;
  catalogPriceMode: string | null;
  /** a unidade da loja (RN-068): "peça"/"peças", "conjunto"/"conjuntos"… */
  unidadeSingular: string | null;
  unidadePlural: string | null;
  categoryUnits: string | null;
};

export async function acervoDaVitrine(
  company: LojaDoAcervo,
  {
    /** "ATACADO" | "VAREJO" — o modo desta visita (o link de tabela manda, RN-018) */
    modo,
    /** desconto do link de campanha já aplicado nos preços (RN-040); 0 = nenhum */
    desconto = 0,
  }: { modo: string | null | undefined; desconto?: number }
): Promise<PecaDoAcervo[]> {
  // as categorias que vendem SOB ENCOMENDA (RN-076): a peça delas não some ao
  // zerar. O filtro depende disso, então a leitura vai na frente
  const catsSobEncomenda = await categoriasSobEncomenda(company.id);

  const products = await db.product.findMany({
    // vitrine pública: só produto ATIVO e COM foto (item sem foto fica oculto
    // até ganhar imagem). Se a loja escolher, esconde também os sem estoque —
    // menos a peça que vende sob encomenda (RN-076)
    where: {
      companyId: company.id,
      active: true,
      images: { some: {} },
      ...(company.catalogHideOutOfStock ? ondeNaoEscondePorEstoque(catsSobEncomenda) : {}),
    },
    include: {
      images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
      variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
    },
    orderBy: [{ collection: "desc" }, { name: "asc" }],
  });

  // a escada da unidade (RN-068): loja e categorias lidas uma vez para todas
  const unidadeLoja = unidadeDaLoja(company);
  const unidadesPorCategoria = parseCategoryUnits(company.categoryUnits);
  // o desconto do link de campanha (RN-040) tem UMA conta, a da própria
  // regra — reescrevê-la aqui daria dois arredondamentos para o mesmo preço
  const comDesconto = (v: number) => precoComDesconto(v, desconto);

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    collection: p.collection,
    description: p.description,
    retailPrice: comDesconto(p.retailPrice),
    wholesalePrice: comDesconto(p.wholesalePrice),
    precoCatalogo: comDesconto(catalogPrice(p, modo)),
    originalRetailPrice: desconto > 0 ? catalogPrice(p, modo) : undefined,
    minQuantity: p.minQuantity,
    tags: p.tags,
    unidade: unidadeDaPeca(p, unidadesPorCategoria, unidadeLoja),
    images: p.images.map((i) => ({ id: i.id, color: i.color })),
    // ordem de ROUPA (PP, P, M, G, GG / numeração crescente): a vitrine segue
    // a arara, não o alfabeto
    variants: ordenarVariantes(p.variants).map((v) => ({
      color: v.color,
      size: v.size,
      // QUANTAS há (RN-067); a peça sob encomenda (RN-076) recebe o teto da
      // linha em vez de parar no estoque
      disponivel: disponivelNaVitrine(
        v.stock,
        vendeSobEncomenda({
          peca: p.sobEncomenda,
          categoria: catsSobEncomenda.has(p.category),
          jueriId: p.jueriId,
        })
      ),
    })),
  }));
}
