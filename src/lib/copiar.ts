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
