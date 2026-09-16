/**
 * COPIAR TEXTO — com plano B.
 *
 * O jeito moderno (`navigator.clipboard`) só existe em página segura
 * (https) e em alguns navegadores exige permissão. Sem plano B, o botão
 * falharia calado justamente em quem usa navegador antigo ou entra pelo
 * endereço de rede — e a vendedora acharia que copiou.
 *
 * Devolve se conseguiu, para a tela dar a resposta certa ("Copiado" ou o
 * aviso de que não deu).
 */
export async function copiarTexto(
  texto: string,
  janela: {
    navigator?: { clipboard?: { writeText(t: string): Promise<void> } };
    document?: Document;
  } = typeof window !== "undefined" ? window : {}
): Promise<boolean> {
  const t = texto ?? "";
  if (!t) return false;

  try {
    const area = janela.navigator?.clipboard;
    if (area?.writeText) {
      await area.writeText(t);
      return true;
    }
  } catch {
    // sem permissão ou página não segura: cai no plano B
  }

  // PLANO B: um campo escondido e o comando antigo do navegador
  const doc = janela.document;
  if (!doc?.body) return false;
  try {
    const campo = doc.createElement("textarea");
    campo.value = t;
    campo.setAttribute("readonly", "");
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    doc.body.appendChild(campo);
    campo.select();
    const ok = doc.execCommand?.("copy") ?? false;
    doc.body.removeChild(campo);
    return !!ok;
  } catch {
    return false;
  }
}

/**
 * O que copiar de uma mensagem.
 *
 * Áudio e imagem sem legenda não têm texto nenhum — copiar "" enganaria a
 * vendedora (o botão pisca "copiado" e o colar vem vazio). Nesse caso a
 * opção nem aparece.
 */
export function textoDaMensagem(m: {
  body?: string | null;
  mediaType?: string | null;
  revoked?: boolean;
}): string {
  if (m.revoked) return ""; // mensagem apagada não se copia
  return (m.body ?? "").trim();
}

/**
 * LEGENDA DA FOTO/VÍDEO/ÁUDIO — o texto que a cliente escreveu junto da mídia.
 *
 * Incidente real (Toque Leve, 31/07/2026): a cliente mandou uma foto com
 * texto embaixo e a loja só viu a foto. A legenda ESTAVA gravada — o sistema
 * a leu certo do WhatsApp —, mas a tela só desenhava o texto quando a
 * mensagem era de texto puro. Numa foto, o texto ficava invisível.
 *
 * Numa negociação isso é caro: a cliente manda a peça e escreve "essa no P,
 * 3 unidades" embaixo, e a vendedora responde como se não tivesse pedido nada.
 *
 * Quando a cliente NÃO escreve nada, o sistema guarda um rótulo ("[foto]") só
 * para a mensagem ter o que mostrar na lista de conversas. Rótulo não é
 * legenda: embaixo da foto ele não pode aparecer.
 */
const ROTULOS_DE_MIDIA = new Set([
  "[foto]",
  "[vídeo]",
  "[video]",
  "[áudio]",
  "[audio]",
  "[figurinha]",
]);

export function legendaDaMidia(m: {
  body?: string | null;
  mediaType?: string | null;
  fileName?: string | null;
}): string {
  const texto = (m.body ?? "").trim();
  if (!texto) return "";
  if (ROTULOS_DE_MIDIA.has(texto.toLowerCase())) return "";
  // documento sem legenda vira "[arquivo] nome-do-arquivo.pdf"
  if (texto.startsWith("[arquivo]")) return "";
  return texto;
}

/**
 * COPIAR SÓ O TRECHO MARCADO (relato do dono, 16/09/2026): *"não consigo
 * selecionar parte do texto no WhatsApp e copiar; quando clico em copiar,
 * copia o texto completo"*.
 *
 * Eram dois problemas somados, e este é o primeiro: o "Copiar mensagem" do
 * menu da bolha sempre mandava `textoDaMensagem(m)` — a mensagem INTEIRA —,
 * ignorando qualquer trecho que a pessoa tivesse acabado de marcar. No
 * computador ela marcava certinho, abria o menu e recebia tudo de volta.
 *
 * A régua tem duas travas, e as duas importam:
 *
 *  • **A seleção precisa estar DENTRO daquela bolha.** Texto marcado noutra
 *    mensagem (ou na lista de conversas) copiaria o pedaço errado sem
 *    ninguém perceber — e o que se copia daqui vai para o WhatsApp da
 *    cliente: um Pix pela metade, um endereço de outra pessoa.
 *  • **Marcação vazia não conta.** Clicar dentro do texto sem arrastar deixa
 *    uma seleção de zero caractere; copiar "" faria o botão piscar "copiado"
 *    e o colar vir vazio (a mesma lição do `textoDaMensagem`).
 */
export function textoParaCopiar(
  mensagemInteira: string,
  selecao: { texto: string; dentroDaBolha: boolean } | null
): string {
  const trecho = (selecao?.texto ?? "").trim();
  if (selecao?.dentroDaBolha && trecho) return trecho;
  return mensagemInteira;
}

/**
 * Lê a marcação do navegador e diz se ela está dentro do elemento dado.
 *
 * **As DUAS pontas têm que estar dentro da bolha** — o começo e o fim. Olhar
 * só o `anchorNode` (a ponta onde o dedo encostou primeiro) errava nos dois
 * sentidos: a marcação feita de BAIXO PARA CIMA tem a âncora no fim e era
 * recusada, copiando a mensagem inteira; e a que começa na bolha e ESCORREGA
 * para fora era aceita levando junto o texto da mensagem vizinha — um Pix
 * pela metade, um endereço de outra pessoa. Escorregou, vale a mensagem
 * inteira: é a falha segura.
 */
export function selecaoDentroDe(
  elemento: Element | null,
  janela: { getSelection?(): Selection | null } = typeof window !== "undefined"
    ? window
    : {}
): { texto: string; dentroDaBolha: boolean } | null {
  const sel = janela.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const texto = sel.toString();
  if (!texto.trim()) return null;
  const dentro = (no: Node | null) =>
    Boolean(elemento && no && (elemento === no || elemento.contains(no)));
  const dentroDaBolha = dentro(sel.anchorNode) && dentro(sel.focusNode);
  return { texto, dentroDaBolha };
}
