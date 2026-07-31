/**
 * FOTO COMPRIMIDA NO APARELHO, ANTES DE ENVIAR.
 *
 * Incidente real (31/07/2026): "toda foto que eu tentei enviar falou que o
 * arquivo está muito pesado". Foto de celular hoje tem 4–12 MB — acima do
 * teto de envio (o servidor corta o pedido perto de 4,5 MB, e o base64 ainda
 * infla 1/3). Ou seja: NENHUMA foto tirada na hora passava.
 *
 * A saída é a mesma do WhatsApp de verdade: comprimir no aparelho. A foto é
 * redimensionada (lado maior ≤ 1600px — mais que suficiente para peça de
 * roupa em tela) e vira JPEG. Uma foto de 8 MB sai daqui com ~300 KB, e o
 * envio fica instantâneo de brinde.
 *
 * Devolve `null` quando o navegador não consegue ler o arquivo (formato
 * exótico) — quem chama decide o plano B.
 */

const LADO_MAX = 1600;
/** Acima disso, tenta uma qualidade menor (dataURL ≈ bytes × 4/3). */
const ALVO_DATAURL = 1_200_000; // ~900 KB de arquivo

async function lerImagem(arquivo: Blob): Promise<ImageBitmap | HTMLImageElement | null> {
  // caminho moderno (já corrige a orientação da câmera)
  try {
    return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    /* navegador antigo: tenta sem opções e depois o plano B */
  }
  try {
    return await createImageBitmap(arquivo);
  } catch {
    /* segue para o plano B */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export async function comprimirFoto(arquivo: Blob): Promise<string | null> {
  try {
    const img = await lerImagem(arquivo);
    if (!img) return null;
    const largura = "width" in img ? img.width : 0;
    const altura = "height" in img ? img.height : 0;
    if (!largura || !altura) return null;

    const escala = Math.min(1, LADO_MAX / Math.max(largura, altura));
    const w = Math.max(1, Math.round(largura * escala));
    const h = Math.max(1, Math.round(altura * escala));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // fundo branco: PNG transparente virando JPEG ficava com fundo preto
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    for (const qualidade of [0.85, 0.75, 0.65]) {
      const dataUrl = canvas.toDataURL("image/jpeg", qualidade);
      if (dataUrl.length <= ALVO_DATAURL) return dataUrl;
    }
    // foto muito detalhada: entrega no mínimo aceitável (sempre cabe no teto)
    return canvas.toDataURL("image/jpeg", 0.55);
  } catch {
    return null;
  }
}

/** O nome do arquivo acompanha o formato final (era .png/.heic, virou JPEG). */
export function nomeJpeg(original: string): string {
  const semExt = original.replace(/\.[a-z0-9]+$/i, "");
  return `${semExt || "foto"}.jpg`;
}
