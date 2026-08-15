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
