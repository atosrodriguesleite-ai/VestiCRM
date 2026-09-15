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

/**
 * MENU ANCORADO A UM BOTÃO — e por que ele não usa a conta de cima.
 *
 * Relato do dono (15/09/2026): na lista de pedidos, tocar no selo de status
 * do último pedido abria o menu **cortado pela borda de baixo** do celular.
 * A causa é a mesma do menu de conversa (`posicaoDoMenu`), mas a conta NÃO é:
 * o menu de contexto nasce no cursor, então "virar" é subir até o ponto do
 * clique; o menu ancorado nasce colado num BOTÃO, e virar é abrir ACIMA dele
 * — se subisse até o ponto, cobriria o próprio botão que a pessoa tocou.
 *
 * Três decisões:
 *
 *  1. **Tenta abaixo, vira para cima, e só então encosta.** É a ordem que
 *     mantém o comportamento normal em 99% dos casos e conserta o canto.
 *  2. **A barra de navegação do celular é chão** (`reservaEmbaixo`): ela é
 *     `fixed bottom-0`, então "caber na janela" não basta — os últimos itens
 *     ficariam embaixo dela, que é exatamente o que a pessoa não alcança.
 *  3. **Não couber em lado nenhum não é erro**: o menu vai para o lado com
 *     MAIS espaço e ganha rolagem interna (`alturaMaximaAncorada`), em vez de
 *     ficar meio de fora. Celular deitado é isso o tempo todo.
 *
 * Alinhamento horizontal: a direita do menu acompanha a direita da âncora (o
 * selo fica na ponta direita da linha), e o resultado é encaixado na janela.
 */

/** Retângulo do botão que abriu o menu (o que `getBoundingClientRect` devolve). */
export type Ancora = { top: number; bottom: number; left: number; right: number };

/** Distância entre o botão e o menu (px). */
export const FOLGA_DA_ANCORA = 6;

export type OpcoesAncora = {
  margem?: number;
  folga?: number;
  /** altura ocupada no pé da tela por algo fixo (a barra de navegação) */
  reservaEmbaixo?: number;
};

/** Espaço livre abaixo e acima da âncora, já descontadas margem e reserva. */
function espacos(ancora: Ancora, janela: Janela, o: Required<OpcoesAncora>) {
  return {
    abaixo: janela.altura - o.reservaEmbaixo - o.margem - (ancora.bottom + o.folga),
    acima: ancora.top - o.folga - o.margem,
  };
}

function normalizar(o?: OpcoesAncora): Required<OpcoesAncora> {
  return {
    margem: o?.margem ?? MARGEM,
    folga: o?.folga ?? FOLGA_DA_ANCORA,
    reservaEmbaixo: o?.reservaEmbaixo ?? 0,
  };
}

/**
 * Altura que o menu pode ocupar naquele lugar. Maior que isso, o menu rola
 * por dentro — nunca passa por baixo da borda.
 */
export function alturaMaximaAncorada(
  ancora: Ancora,
  janela: Janela,
  opcoes?: OpcoesAncora
): number {
  const o = normalizar(opcoes);
  const { abaixo, acima } = espacos(ancora, janela, o);
  return Math.max(abaixo, acima, 0);
}

export function posicaoAncorada(
  ancora: Ancora,
  menu: Tamanho,
  janela: Janela,
  opcoes?: OpcoesAncora
): Ponto {
  const o = normalizar(opcoes);
  const { abaixo, acima } = espacos(ancora, janela, o);

  // vertical: abaixo é o normal; não cabendo, acima; não cabendo em nenhum,
  // o lado mais folgado (com rolagem interna, por `alturaMaximaAncorada`)
  let y: number;
  if (menu.altura <= abaixo) y = ancora.bottom + o.folga;
  else if (menu.altura <= acima) y = ancora.top - o.folga - menu.altura;
  else if (abaixo >= acima) y = ancora.bottom + o.folga;
  else y = ancora.top - o.folga - menu.altura;

  // E MESMO ASSIM ENCOSTA NA MARGEM (o passo 3 do `posicaoDoMenu`, que o
  // teste da varredura pegou faltando aqui): botão que já nasce embaixo da
  // barra — celular com teclado aberto, rolagem no meio do gesto — deixava o
  // menu começando fora do chão. Escolher o lado não basta; o resultado
  // precisa caber.
  const chao = janela.altura - o.reservaEmbaixo - o.margem;
  if (y + menu.altura > chao) y = chao - menu.altura;
  if (y < o.margem) y = o.margem;

  // horizontal: acompanha a direita do botão e encaixa na janela
  let x = ancora.right - menu.largura;
  if (x + menu.largura + o.margem > janela.largura) x = janela.largura - menu.largura - o.margem;
  if (x < o.margem) x = o.margem;

  return { x, y };
}

/**
 * Altura da barra de navegação do celular, medida no DOM (nunca chutada: ela
 * muda com a `safe-area` do aparelho). Zero no computador, onde ela não existe.
 */
export function alturaDaBarraInferior(): number {
  if (typeof document === "undefined") return 0;
  const barra = document.querySelector(".barra-inferior");
  if (!barra) return 0;
  const r = barra.getBoundingClientRect();
  // só conta se ela estiver realmente visível (no computador fica `display:none`)
  return r.height > 0 && r.bottom >= window.innerHeight - 1 ? r.height : 0;
}
