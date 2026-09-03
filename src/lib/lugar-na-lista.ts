/**
 * A LISTA DE CONVERSAS NÃO PERDE O LUGAR (RN-046).
 *
 * Relato da loja (03/09/2026): a vendedora faz follow-up **de baixo para
 * cima** — desce até as conversas mais antigas, abre uma, encerra, e queria
 * seguir da vizinha. Só que ela voltava para o TOPO da lista e tinha que
 * rolar tudo de novo, conversa após conversa.
 *
 * O motivo é do NAVEGADOR, não da tela: no celular a lista é escondida com
 * `display: none` enquanto o chat está aberto (é a mesma coluna), e elemento
 * escondido **perde a posição de rolagem** — quando volta a aparecer, o
 * `scrollTop` é zero. Não é bug de código nosso, é comportamento do CSS; por
 * isso a posição tem que ser guardada por nós e devolvida na volta.
 *
 * ESTE ARQUIVO É PURO: as três decisões (devolver ou não, para onde, e se o
 * atalho aparece) se testam sem navegador.
 */

/**
 * A lista está ESCONDIDA agora?
 *
 * É a pergunta que separa "ela rolou até aqui" de "o navegador zerou porque
 * escondeu": elemento com `display:none` tem altura visível ZERO. Sem essa
 * distinção, a régua teria de ser "scrollTop maior que zero" — e aí o topo
 * ficaria inalcançável: a vendedora que subisse de propósito voltaria
 * puxada para o lugar antigo a cada ida ao chat (achado da revisão,
 * 03/09/2026).
 */
export function listaEstaEscondida(alturaVisivel: number): boolean {
  return !Number.isFinite(alturaVisivel) || alturaVisivel <= 0;
}

/**
 * A posição atual merece ser guardada?
 *
 * Qualquer posição da lista VISÍVEL vale — inclusive o zero, que é um lugar
 * legítimo (ela subiu até o começo). O que não vale é o zero da lista
 * escondida, que não é lugar nenhum: é o navegador jogando fora a rolagem.
 */
export function vaiGuardarOLugar(scrollTop: number, alturaVisivel: number): boolean {
  return !listaEstaEscondida(alturaVisivel) && Number.isFinite(scrollTop) && scrollTop >= 0;
}

/**
 * Devolver o lugar agora?
 *
 * SÓ quando a lista voltou zerada E o lugar guardado é outro. No computador a
 * lista nunca é escondida (fica ao lado do chat), então ela já está no lugar
 * certo — mexer no scroll ali seria um pulo do nada na frente da vendedora. E
 * quem estava no topo de propósito continua no topo (guardado é zero).
 */
export function vaiDevolverOLugar(scrollTopAtual: number, guardado: number): boolean {
  return scrollTopAtual === 0 && guardado > 0;
}

/**
 * Para onde voltar, dado o quanto a lista pode rolar agora.
 *
 * A lista ENCOLHE quando a conversa encerrada sai da aba, então o lugar
 * guardado pode não existir mais: encaixa no máximo possível, em vez de
 * pedir uma posição que não há (o navegador ignoraria e ela voltaria ao topo,
 * que é o problema que estamos consertando).
 */
export function lugarParaVoltar(guardado: number, rolagemMaxima: number): number {
  if (!Number.isFinite(guardado) || guardado <= 0) return 0;
  if (!Number.isFinite(rolagemMaxima) || rolagemMaxima <= 0) return 0;
  return Math.min(guardado, rolagemMaxima);
}

/**
 * O atalho de descer/subir aparece?
 *
 * A régua é **sobrar mais de uma tela para rolar** (conteúdo maior que duas
 * telas): aí rolar na mão já incomoda de verdade. Em lista curta o botão
 * seria enfeite tampando conversa.
 */
export function mostraAtalhoDaLista(
  alturaDoConteudo: number,
  alturaVisivel: number
): boolean {
  if (!Number.isFinite(alturaDoConteudo) || !Number.isFinite(alturaVisivel)) return false;
  if (alturaVisivel <= 0) return false;
  return alturaDoConteudo - alturaVisivel > alturaVisivel;
}

/**
 * Para onde o atalho leva: a lista está mais para o começo → desce até o
 * fim; já está na metade de baixo → sobe para o topo. Um botão só, sempre
 * apontando para onde ainda falta ir.
 */
export function sentidoDoAtalho(
  scrollTop: number,
  rolagemMaxima: number
): "fim" | "topo" {
  if (!Number.isFinite(rolagemMaxima) || rolagemMaxima <= 0) return "fim";
  return scrollTop < rolagemMaxima / 2 ? "fim" : "topo";
}
