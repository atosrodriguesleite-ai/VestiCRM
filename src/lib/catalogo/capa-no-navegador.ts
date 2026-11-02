"use client";

import {
  CAPA_ALTURA_PX,
  CAPA_LARGURA_PX,
  TETO_BYTES_DO_ARQUIVO,
  motivoDaRecusa,
  recorteParaA4,
} from "@/lib/catalogo/capa-pdf-regra";

/**
 * A CAPA ESCOLHIDA PELA LOJA, PREPARADA NO NAVEGADOR (RN-094, item 6).
 *
 * O arquivo do Canva vem a 300 dpi (2480 × 3508, 3 a 8 MB) e a porta do
 * servidor recebe no máximo 4,5 MB (limite da Vercel) — então quem recorta e
 * encolhe é o navegador, pela MESMA régua do servidor (`capa-pdf-regra.ts`):
 * confere a proporção, apara a borda fina pelo centro até o A4 exato e
 * entrega um JPEG de 1240 × 1754 (~300–600 KB). O servidor confere de novo.
 *
 * Devolve a frase da recusa em português quando a imagem não serve; e avisa
 * quanto aparou quando passou de 0,5% — a lojista precisa saber que a borda
 * saiu ANTES de salvar, não pela cliente.
 */
export async function prepararCapaNoNavegador(
  arquivo: File
): Promise<{ ok: true; dataUrl: string; aviso: string | null } | { ok: false; erro: string }> {
  if (arquivo.size > TETO_BYTES_DO_ARQUIVO) {
    return { ok: false, erro: "Arquivo maior que 20 MB. Baixe do Canva como JPG (qualidade alta) e tente de novo." };
  }
  let img: ImageBitmap | null = null;
  try {
    // `imageOrientation: "from-image"` aplica o giro da câmera, como o servidor
    img = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, erro: "Não deu para ler a imagem. Envie um JPG ou PNG." };
  }
  try {
    const recusa = motivoDaRecusa(img.width, img.height);
    if (recusa) return { ok: false, erro: recusa };

    const r = recorteParaA4(img.width, img.height);
    const canvas = document.createElement("canvas");
    canvas.width = CAPA_LARGURA_PX;
    canvas.height = CAPA_ALTURA_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, erro: "Este navegador não conseguiu preparar a imagem. Tente pelo computador." };
    // PNG transparente vira fundo branco (a capa é a folha inteira)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
    canvas.width = 0;
    canvas.height = 0;
    const aviso =
      r.aparouPct >= 0.5
        ? `A imagem não era exatamente A4: ${r.aparouPct}% da ${r.eixo} foi aparado nas bordas. Confira a prévia.`
        : null;
    return { ok: true, dataUrl, aviso };
  } finally {
    img.close();
  }
}
