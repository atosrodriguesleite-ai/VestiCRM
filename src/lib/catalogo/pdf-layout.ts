/**
 * A PÁGINA DO CATÁLOGO EM PDF — geometria e paginação (RN-094).
 *
 * Separado do desenho de propósito: "onde cada peça cai" é a parte que
 * erra (peça cortada no pé da página, categoria órfã, linha por cima do
 * texto da linha de cima — os três defeitos da primeira amostra) e é a
 * única que dá para provar sem abrir PDF nenhum.
 *
 * Tudo em PONTOS do PDF (1 pt = 1/72"), com a origem no canto inferior
 * esquerdo, que é como o pdf-lib trabalha.
 */

/** A4 em pontos. */
export const A4_LARGURA = 595;
export const A4_ALTURA = 842;

export const LAYOUT = {
  margem: 42,
  colunas: 3,
  /** respiro entre colunas */
  calha: 17,
  /**
   * Altura da foto do card.
   *
   * O número saiu de OLHAR a página renderizada: com 184 cabiam só DUAS
   * fileiras e sobrava um terço da folha em branco no pé — 42 páginas para
   * 243 peças, com a página parecendo inacabada. Em 168 cabem TRÊS fileiras
   * (9 peças por folha) e a foto continua em pé (168 × 159), que é o formato
   * de foto de roupa. Mexer aqui mexe em tudo: a proporção do recorte da
   * foto sai daqui (`lerFotosParaPdf`).
   */
  fotoAltura: 162,
  /**
   * Altura do texto embaixo da foto: nome, cor, preço e a linha de tamanhos.
   *
   * Tem que ser o que o texto OCUPA DE VERDADE — as linhas descem 12 + 11 +
   * 13 + 11 a partir do pé da foto, mais o descendente. Reservar menos foi o
   * defeito que apareceu na página renderizada: na última fileira o "mínimo
   * 4 peças" encostava no rodapé.
   */
  textoAltura: 58,
  /** respiro entre uma linha de cards e a seguinte */
  entreLinhas: 12,
  /** da margem de cima até o começo do conteúdo (cabeçalho corrido) */
  topo: 58,
  /** do pé da página até o fim do conteúdo (rodapé com página e WhatsApp) */
  rodape: 50,
  /** altura do título da categoria ("Conjuntos de short · 6 opções") */
  tituloAltura: 40,
} as const;

export type Layout = typeof LAYOUT;

/** Largura de um card, derivada da largura útil e do número de colunas. */
export function larguraDoCard(l: Layout = LAYOUT): number {
  const util = A4_LARGURA - l.margem * 2 - l.calha * (l.colunas - 1);
  return util / l.colunas;
}

/** Altura total de um card (foto + texto). */
export function alturaDoCard(l: Layout = LAYOUT): number {
  return l.fotoAltura + l.textoAltura;
}

/** O x da coluna `i` (0-based). */
export function xDaColuna(i: number, l: Layout = LAYOUT): number {
  return l.margem + i * (larguraDoCard(l) + l.calha);
}

/** Altura útil de uma página (entre o cabeçalho corrido e o rodapé). */
export function alturaUtil(l: Layout = LAYOUT): number {
  return A4_ALTURA - l.topo - l.rodape;
}

/**
 * Uma linha desenhada na página. `titulo` só existe na primeira linha de
 * cada categoria (e nunca sozinho no pé da página — ver `paginar`).
 */
export type LinhaDaPagina<C> = {
  /** o título da categoria, quando esta linha o abre */
  titulo?: { categoria: string; totalDeCards: number };
  cards: C[];
  /** y do TOPO da linha (coordenada do pdf-lib: cresce para cima) */
  topoY: number;
};

export type PaginaDoCatalogo<C> = {
  /** a categoria que o cabeçalho corrido mostra (a da primeira linha) */
  categoria: string;
  linhas: LinhaDaPagina<C>[];
};

export type SecaoParaPaginar<C> = { categoria: string; cards: C[] };

/**
 * A PAGINAÇÃO.
 *
 * Regras que vieram de olhar as páginas renderizadas:
 *  • cada categoria começa em linha nova (nunca duas categorias na mesma
 *    fileira — a cliente leria o vestido como se fosse short);
 *  • **título nunca fica órfão**: se o título couber mas a primeira linha de
 *    cards não, os dois vão juntos para a página seguinte;
 *  • categoria que atravessa a página continua sem repetir o título grande:
 *    o cabeçalho corrido da página seguinte já diz qual categoria é.
 */
export function paginar<C>(
  secoes: SecaoParaPaginar<C>[],
  l: Layout = LAYOUT
): PaginaDoCatalogo<C>[] {
  const paginas: PaginaDoCatalogo<C>[] = [];
  const alturaCard = alturaDoCard(l);
  const baseY = A4_ALTURA - l.topo;
  const limiteY = l.rodape;

  let y = baseY;

  for (const secao of secoes) {
    if (secao.cards.length === 0) continue;

    const fileiras: C[][] = [];
    for (let i = 0; i < secao.cards.length; i += l.colunas) {
      fileiras.push(secao.cards.slice(i, i + l.colunas));
    }

    let primeira = true;
    for (const fileira of fileiras) {
      // o título acompanha a PRIMEIRA fileira: medir os dois juntos é o que
      // impede o título de ficar sozinho no pé da página
      const precisa = (primeira ? l.tituloAltura : 0) + alturaCard;
      if (paginas.length === 0 || y - precisa < limiteY) {
        paginas.push({ categoria: secao.categoria, linhas: [] });
        y = baseY;
      }
      const p = paginas[paginas.length - 1];
      const abreTitulo = primeira;
      if (abreTitulo) y -= l.tituloAltura;
      p.linhas.push({
        ...(abreTitulo
          ? { titulo: { categoria: secao.categoria, totalDeCards: secao.cards.length } }
          : {}),
        cards: fileira,
        topoY: y,
      });
      y -= alturaCard + l.entreLinhas;
      primeira = false;
    }
  }

  return paginas;
}

/**
 * A LINHA DE TAMANHOS DO CARD — só os que a cliente PODE pedir.
 *
 * É o que o PDF ganha e a tela não tem: no site ela TOCA no card para abrir a
 * grade, e lá o tamanho esgotado aparece apagado; no papel não há toque nem
 * como apagar uma palavra. Listar a grade inteira sem distinguir faria a
 * cliente pedir o M que não existe — o estrago que a RN-067 existe para
 * evitar (achado da revisão). Então o esgotado simplesmente não entra, com
 * ou sem a chavinha "esconder sem estoque" da loja; quando NENHUM tamanho
 * sobra, o card já diz "Indisponível" no lugar desta linha.
 */
export function textoDosTamanhos(sizes: { size: string; available: boolean }[]): string {
  return sizes
    .filter((s) => s.available)
    .map((s) => s.size)
    .join(" · ");
}
