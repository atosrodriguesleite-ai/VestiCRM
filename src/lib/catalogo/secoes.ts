/**
 * AS SEÇÕES DA VITRINE — uma régua só para a tela e para o PDF (RN-094).
 *
 * O catálogo público mostra **um card por COR**, agrupado por categoria, na
 * ordem que a loja escolheu (e, quando ela usa TIPOS de peça, com tudo de um
 * tipo junto — foi a causa do "o short não aparece no catálogo", 09/08/2026).
 * Essa derivação morava dentro do componente React da vitrine.
 *
 * Quando o catálogo em PDF nasceu (RN-094), copiá-la teria criado DUAS listas
 * que envelhecem separadas: o dia em que a vitrine mudar de regra, o PDF
 * passa a mostrar peça que o site não mostra — e o preço que a cliente lê no
 * papel deixa de ser o que a loja cobra. Dinheiro não pode divergir entre
 * telas, então a regra mora aqui e as duas a importam.
 *
 * É PURA de propósito (sem banco, sem React): o PDF roda no servidor e a
 * vitrine no navegador.
 */

import {
  agruparPorTipo,
  chaveDeCategoria,
  rotuloDeCategoria,
  sortCategories,
  type TiposDeCategoria,
} from "@/lib/categories";
import { compareSizes } from "@/lib/sizes";

/** o mínimo que uma peça precisa ter para virar card (o resto é de quem chama) */
export type PecaParaSecao = {
  id: string;
  category: string;
  /** `disponivel` = QUANTAS há daquela cor × tamanho hoje (RN-067) */
  variants: { color: string; size: string; disponivel: number }[];
};

export type TamanhoDoCard = {
  size: string;
  /** derivado de `disponivel` num lugar só — dois campos para o mesmo fato desencontram */
  available: boolean;
  disponivel: number;
};

export type CardDaVitrine<P extends PecaParaSecao> = {
  /** a chave da sacola: produto|cor */
  key: string;
  product: P;
  color: string;
  sizes: TamanhoDoCard[];
};

export type SecaoDaVitrine<P extends PecaParaSecao> = {
  /** o rótulo CANÔNICO da categoria (a primeira grafia vista, limpa) */
  categoria: string;
  cards: CardDaVitrine<P>[];
};

export type OpcoesDasSecoes = {
  /**
   * A chavinha "esconder peça sem estoque" da loja. Vale POR COR: o filtro do
   * servidor só tira o produto quando TODAS as cores zeram, mas a vitrine
   * mostra um card por cor e o da cor esgotada continuava lá (relato da
   * Entre Linhas). A peça que vende sob encomenda (RN-076) chega aqui com
   * `disponivel` no teto da linha, então nunca é escondida.
   */
  hideSoldOut?: boolean;
  /** a ordem de categorias que a loja escolheu em Personalizar catálogo */
  categoryOrder?: string[];
  /** os TIPOS (guarda-chuva das categorias); mapa vazio = loja não usa */
  categoryTypes?: TiposDeCategoria;
};

/**
 * O rótulo canônico de cada categoria presente no acervo.
 *
 * Nomes byte-diferentes que renderizam IGUAIS (o "ç" decomposto que o iOS e a
 * Nuvemshop gravam, espaço no fim, espaço invisível) viravam DUAS seções e
 * duas abas gêmeas. Junta pela chave normalizada e exibe a primeira grafia
 * vista, limpa.
 */
export function rotulosCanonicos(pecas: { category: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pecas) {
    const k = chaveDeCategoria(p.category);
    if (!m.has(k)) m.set(k, rotuloDeCategoria(p.category));
  }
  return m;
}

/**
 * As categorias na ORDEM em que a página é desenhada: a ordem escolhida pela
 * loja e, por cima dela, o agrupamento por TIPO — tudo de um tipo junto, com
 * "Outros" (categoria sem guarda-chuva) por último. Loja que não usa tipos
 * não muda nada: `agruparPorTipo` devolve lista vazia e vale a ordem crua.
 */
export function categoriasNaOrdem(
  rotulos: Map<string, string>,
  { categoryOrder = [], categoryTypes = {} }: OpcoesDasSecoes = {}
): string[] {
  const brutas = sortCategories([...rotulos.values()], categoryOrder);
  const grupos = agruparPorTipo(brutas, categoryTypes);
  return grupos.length ? grupos.flatMap((g) => g.categorias) : brutas;
}

/**
 * A VITRINE INTEIRA, seção por seção, na ordem em que aparece.
 *
 * Seção sem nenhum card sai da lista: com "esconder sem estoque" ligado, a
 * categoria em que TODA cor zerou viraria um título com o vazio embaixo.
 * (A vitrine na tela já pulava a seção vazia ao desenhar; o PDF ganharia
 * uma página em branco.)
 */
export function secoesDaVitrine<P extends PecaParaSecao>(
  pecas: P[],
  opcoes: OpcoesDasSecoes = {}
): SecaoDaVitrine<P>[] {
  const rotulos = rotulosCanonicos(pecas);
  const ordem = categoriasNaOrdem(rotulos, opcoes);
  const porCategoria = new Map<string, CardDaVitrine<P>[]>();
  for (const cat of ordem) porCategoria.set(cat, []);

  for (const p of pecas) {
    for (const card of cardsDaPeca(p, opcoes.hideSoldOut ?? false)) {
      // a seção da peça é a CANÔNICA — sem isso a variante byte-diferente não
      // achava a própria seção e o card sumia da página
      const cat = rotulos.get(chaveDeCategoria(p.category)) ?? p.category;
      porCategoria.get(cat)?.push(card);
    }
  }

  return ordem
    .map((categoria) => ({ categoria, cards: porCategoria.get(categoria) ?? [] }))
    .filter((s) => s.cards.length > 0);
}

/** Os cards de UMA peça: um por cor, tamanhos na ordem da arara. */
export function cardsDaPeca<P extends PecaParaSecao>(
  peca: P,
  hideSoldOut: boolean
): CardDaVitrine<P>[] {
  const cards: CardDaVitrine<P>[] = [];
  // `new Set` preserva a ordem de inserção, que é a do `orderBy` do banco
  // (cor asc) — a vitrine e o PDF listam as cores na mesma sequência
  for (const color of new Set(peca.variants.map((v) => v.color))) {
    const sizes = peca.variants
      .filter((v) => v.color === color)
      .map((v) => ({ size: v.size, available: v.disponivel > 0, disponivel: v.disponivel }))
      // tamanhos sempre do menor para o maior (PP, P, M, G, GG / 36, 38, 40)
      .sort((a, b) => compareSizes(a.size, b.size));
    if (hideSoldOut && sizes.every((s) => !s.available)) continue;
    cards.push({ key: `${peca.id}|${color}`, product: peca, color, sizes });
  }
  return cards;
}

/** Quantas peças a vitrine está mostrando (para a capa do PDF e a contagem). */
export function contarCards<P extends PecaParaSecao>(secoes: SecaoDaVitrine<P>[]): number {
  return secoes.reduce((n, s) => n + s.cards.length, 0);
}
