/**
 * FOTO COMPRIMIDA NO APARELHO, ANTES DE ENVIAR.
 *
 * Incidente real (31/07/2026): "toda foto que eu tentei enviar falou que o
 * arquivo está muito pesado". Foto de celular hoje tem 4–12 MB — acima do
 * teto de envio (o servidor corta o pedido perto de 4,5 MB, e o base64 ainda
 * infla 1/3). Ou seja: NENHUMA foto tirada na hora passava.
 *
 * A saída é a mesma do WhatsApp de verdade: comprimir no aparelho. A foto é
 * redimensionada e vira JPEG, e o envio fica rápido de brinde.
 *
 * ALTA RESOLUÇÃO (pedido do dono, 27/08/2026): o lado maior era 1600px com
 * alvo de ~900 KB — bom para caber, ruim para VENDER. A cliente dá zoom na
 * peça para ver a trama do tecido, o acabamento da costura e a etiqueta, e
 * nesse tamanho tudo virava borrão. Agora o lado maior é 2560px com alvo de
 * ~2,2 MB (o mesmo espírito do "HD" do WhatsApp), que ainda cabe FOLGADO no
 * teto do envio. Foto boa é o catálogo da loja.
 *
 * Devolve `null` quando o navegador não consegue ler o arquivo (formato
 * exótico) — quem chama decide o plano B.
 */

const LADO_MAX = 2560;
/** Acima disso, tenta uma qualidade menor (dataURL ≈ bytes × 4/3). */
const ALVO_DATAURL = 3_000_000; // ~2,2 MB de arquivo
/**
 * Teto DURO: acima disso o envio é recusado pelo servidor (corte perto de
 * 4,5 MB). Foto tão detalhada que nem a qualidade mínima resolve volta a
 * 1600px — melhor menor e ENTREGUE do que grande e recusada.
 */
const TETO_DATAURL = 4_000_000;

/**
 * Quantas fotos a vendedora manda de uma vez (pedido do dono, 27/08/2026).
 *
 * Elas saem UMA ATRÁS DA OUTRA, não todas juntas: cada foto é um envio de
 * verdade, e disparar vinte ao mesmo tempo é exatamente o que faz o WhatsApp
 * desconfiar da conta (RN-017) — além de estourar o teto de tamanho do
 * pedido, que é por envio.
 *
 * Mora aqui (e não na tela) porque o teste precisa do MESMO número.
 */
export const TETO_FOTOS_DE_UMA_VEZ = 20;

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

/** Vira dataURL sem TRAVAR a tela: `toBlob` trabalha fora da linha principal. */
function paraDataUrl(canvas: HTMLCanvasElement, qualidade: number): Promise<string | null> {
  return new Promise((resolve) => {
    // `toDataURL` codifica na LINHA PRINCIPAL: numa fila de vinte fotos de
    // 2560px a tela congelava em solavancos — inclusive a barra que mostra o
    // andamento, justamente quando ela mais precisa aparecer
    if (typeof canvas.toBlob !== "function") {
      resolve(canvas.toDataURL("image/jpeg", qualidade));
      return;
    }
    // codificador falhou (memória, canvas grande demais): cai no caminho
    // síncrono em vez de devolver nada. Devolver `null` aqui era pior que
    // travar um instante — a tela acusava "formato não reconhecido" numa
    // foto JPEG comum e, se ela coubesse no teto, mandava o arquivo
    // ORIGINAL sem comprimir.
    const plandoB = () => {
      try {
        resolve(canvas.toDataURL("image/jpeg", qualidade));
      } catch {
        resolve(null);
      }
    };
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          plandoB();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = plandoB;
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      qualidade
    );
  });
}

/** Desenha no tamanho pedido e devolve o dataURL com a melhor qualidade que couber. */
async function desenhar(
  img: ImageBitmap | HTMLImageElement,
  largura: number,
  altura: number,
  ladoMax: number
): Promise<string | null> {
  const escala = Math.min(1, ladoMax / Math.max(largura, altura));
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

  let saida: string | null = null;
  for (const qualidade of [0.92, 0.85, 0.75]) {
    const dataUrl = await paraDataUrl(canvas, qualidade);
    if (!dataUrl) break;
    saida = dataUrl;
    if (dataUrl.length <= ALVO_DATAURL) break;
  }
  if (saida && saida.length > ALVO_DATAURL) {
    // foto muito detalhada: entrega no mínimo aceitável
    saida = (await paraDataUrl(canvas, 0.6)) ?? saida;
  }
  // libera a memória do canvas ANTES da próxima foto: com vinte seguidas, o
  // navegador do celular ficava sem memória no meio da fila
  canvas.width = 0;
  canvas.height = 0;
  return saida;
}

export async function comprimirFoto(arquivo: Blob): Promise<string | null> {
  let img: ImageBitmap | HTMLImageElement | null = null;
  try {
    img = await lerImagem(arquivo);
    if (!img) return null;
    const largura = "width" in img ? img.width : 0;
    const altura = "height" in img ? img.height : 0;
    if (!largura || !altura) return null;

    const alta = await desenhar(img, largura, altura, LADO_MAX);
    if (!alta) return null;
    // nem no mínimo coube: volta ao tamanho antigo, que sempre passou
    if (alta.length > TETO_DATAURL) return await desenhar(img, largura, altura, 1600);
    return alta;
  } catch {
    return null;
  } finally {
    // ImageBitmap segura memória até ser fechado (o navegador do celular
    // derrubava a aba na décima foto sem isto)
    if (img && "close" in img) img.close();
  }
}

/** O nome do arquivo acompanha o formato final (era .png/.heic, virou JPEG). */
export function nomeJpeg(original: string): string {
  const semExt = original.replace(/\.[a-z0-9]+$/i, "");
  return `${semExt || "foto"}.jpg`;
}
