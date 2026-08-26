/**
 * ONDE O MENU DE CLIQUE-DIREITO APARECE NA TELA.
 *
 * Pedido do dono (26/08/2026): "conferir as extremidades, para que não corte
 * as opções naquelas conversas muito no canto superior ou inferior".
 *
 * É o problema clássico do menu de contexto: ele nasce no ponto do clique e,
 * se a conversa está no pé da lista, metade das opções fica embaixo da borda
 * da janela — sem rolagem, sem jeito de alcançar.
 *
 * A regra tem duas partes, nesta ordem:
 *
 *  1. VIRA PARA O LADO QUE TEM ESPAÇO. Clique perto do pé → o menu sobe (a
 *     borda de baixo dele encosta no ponto do clique); clique perto da borda
 *     direita → ele abre para a esquerda. É o que o WhatsApp faz.
 *  2. E MESMO ASSIM ENCOSTA NA MARGEM. Se depois de virar ainda não couber
 *     (janela baixa, menu grande), o menu é empurrado para dentro, com uma
 *     folga da borda. Nunca fica com um pedaço de fora.
 *
 * Função pura: recebe números, devolve números. Dá para conferir sem
 * navegador — é assim que a regra das bordas fica guardada por teste.
 */

/** Folga mínima entre o menu e a borda da janela (px). */
export const MARGEM = 8;

export type Ponto = { x: number; y: number };
export type Tamanho = { largura: number; altura: number };
export type Janela = { largura: number; altura: number };

export function posicaoDoMenu(
  clique: Ponto,
  menu: Tamanho,
  janela: Janela,
  margem: number = MARGEM
): Ponto {
  const encaixar = (
    ponto: number,
    tamanho: number,
    limite: number
  ): number => {
    // 1) cabe abrindo para frente? é o caminho normal
    let inicio = ponto;
    if (inicio + tamanho + margem > limite) {
      // 2) vira para trás (o menu "sobe" / abre para a esquerda)
      inicio = ponto - tamanho;
    }
    // 3) ainda assim não coube: encosta na margem mais próxima
    if (inicio + tamanho + margem > limite) inicio = limite - tamanho - margem;
    if (inicio < margem) inicio = margem;
    return inicio;
  };
  return {
    x: encaixar(clique.x, menu.largura, janela.largura),
    y: encaixar(clique.y, menu.altura, janela.altura),
  };
}

/**
 * Altura máxima que o menu pode ter naquele ponto, para caber na janela.
 * Menu maior que isso ganha rolagem interna em vez de sair da tela — o caso
 * do celular deitado, em que sobra pouca altura.
 */
export function alturaMaxima(clique: Ponto, janela: Janela, margem: number = MARGEM): number {
  const paraBaixo = janela.altura - clique.y - margem;
  const paraCima = clique.y - margem;
  return Math.max(paraBaixo, paraCima, 0);
}
