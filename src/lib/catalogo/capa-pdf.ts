import sharp from "sharp";
import { dataUrlToBuffer, bufferToDataUrl, lerImagem } from "@/lib/img-server";
import {
  CAPA_ALTURA_PX,
  CAPA_LARGURA_PX,
  TETO_DATAURL_ENVIADA,
  motivoDaRecusa,
} from "@/lib/catalogo/capa-pdf-regra";

/**
 * A CAPA ENVIADA PELA LOJA, CONFERIDA E RECOMPRIMIDA NO SERVIDOR (RN-094,
 * item 6).
 *
 * O navegador já recorta e encolhe antes de mandar (`capa-no-navegador.ts`),
 * mas quem grava no banco é esta porta, e ela não confia no que chegou: lê o
 * formato pelo CONTEÚDO (a régua do `lerImagem`, RN-070 — o rótulo da
 * data-URL é digitável), aplica a MESMA régua de proporção do navegador e
 * grava sempre como JPEG no tamanho exato do A4 a 150 dpi. Assim o PDF embute
 * a imagem como ela está, sem reler nem recortar a cada geração, e a capa
 * de 12 MB que alguém mandar por fora vira meio megabyte.
 *
 * A MINIATURA (~10 KB) nasce aqui, junto: é o que a tela de Configurações
 * mostra — refazer o encolhimento a cada abertura da tela era trabalho
 * repetido e idêntico (achado da revisão), e mandar o data-URL inteiro na
 * página era o peso da RN-070.
 *
 * `{ ok: false, erro }` é a frase em português que a tela mostra.
 */
export async function prepararCapaEnviada(
  dataUrl: string
): Promise<
  { ok: true; imagem: string; miniatura: string; bytes: number } | { ok: false; erro: string }
> {
  if (dataUrl.length > TETO_DATAURL_ENVIADA) {
    return {
      ok: false,
      erro: "A imagem passou do tamanho que dá para enviar. Reduza para 1240 × 1754 px e tente de novo.",
    };
  }
  // data-URL sem base64 e com escape torto faz o decodificador LANÇAR: aqui
  // vira a mesma frase, nunca um 500 (achado da revisão)
  let lido: ReturnType<typeof dataUrlToBuffer> = null;
  try {
    lido = dataUrlToBuffer(dataUrl);
  } catch {
    lido = null;
  }
  if (!lido) return { ok: false, erro: "Não deu para ler a imagem. Envie um JPG ou PNG." };

  const meta = await lerImagem(lido.buf);
  if (!meta) return { ok: false, erro: "Não deu para ler a imagem. Envie um JPG ou PNG." };
  // para a régua vale a imagem como ela será DESENHADA: com o giro da
  // câmera, os lados trocam
  const largura = meta.girada ? meta.height : meta.width;
  const altura = meta.girada ? meta.width : meta.height;
  const recusa = motivoDaRecusa(largura, altura);
  if (recusa) return { ok: false, erro: recusa };

  try {
    const jpeg = await sharp(lido.buf)
      .rotate()
      // o recorte pelo CENTRO no A4 exato (a borda fina sai, nada estica)
      .resize({ width: CAPA_LARGURA_PX, height: CAPA_ALTURA_PX, fit: "cover", position: "centre" })
      // PNG transparente vira fundo branco — a capa é a folha inteira
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    const mini = await sharp(jpeg).resize({ width: 220 }).jpeg({ quality: 70 }).toBuffer();
    return {
      ok: true,
      imagem: bufferToDataUrl(jpeg, "image/jpeg"),
      miniatura: bufferToDataUrl(mini, "image/jpeg"),
      bytes: jpeg.byteLength,
    };
  } catch {
    return { ok: false, erro: "Não deu para preparar a imagem. Tente salvar de novo como JPG." };
  }
}

/**
 * A capa guardada, pronta para o PDF embutir (JPEG). O que foi gravado por
 * `prepararCapaEnviada` já está no formato; texto torto (coluna mexida à
 * mão) devolve `null` e o PDF sai com a capa automática — capa errada nunca
 * derruba o catálogo.
 */
export function capaGuardadaParaOPdf(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl?.startsWith("data:image/jpeg")) return null;
  const lido = dataUrlToBuffer(dataUrl);
  if (!lido || lido.buf.byteLength < 100) return null;
  // a assinatura do JPEG (FF D8): o embedJpg do pdf-lib derruba com outra coisa
  if (lido.buf[0] !== 0xff || lido.buf[1] !== 0xd8) return null;
  return lido.buf;
}
