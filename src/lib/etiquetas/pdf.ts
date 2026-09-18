/**
 * ETIQUETAS EM PDF, uma página por LINHA do rolo, na MEDIDA exata (RN-059).
 *
 * É o caminho que serve para QUALQUER impressora de etiqueta pelo driver do
 * sistema (Zebra pelo ZDesigner, Elgin pelo driver dela) e para conferir na
 * tela. A mesma lista de elementos do ZPL; aqui a largura do texto é medida
 * com a fonte de verdade, então este é o desenho mais fiel.
 *
 * O PLANO de cada peça (textos já encaixados, retângulos das barras) é
 * montado UMA vez; cada coluna/cópia só desenha, deslocada pela matriz de
 * transformação da página (e girada, quando a etiqueta é girada).
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { textoPdf } from "@/lib/pdf-texto";
import { barrasEan13, ean13Valido } from "./ean13";
import {
  alturaDaLinhaMm,
  areaDeDesenho,
  expandirLote,
  larguraDaLinha,
  linhasDoElemento,
  linhasDoRolo,
  xDaColuna,
  type DadosEtiqueta,
  type Modelo,
} from "./modelo";

const PT_POR_MM = 72 / 25.4;
/** teto de etiquetas num PDF só (500 já é um rolo) */
export const TETO_ETIQUETAS_POR_PDF = 500;

type Op =
  | { tipo: "texto"; texto: string; x: number; y: number; pt: number; fonte: PDFFont }
  | { tipo: "rect"; x: number; y: number; w: number; h: number }
  | { tipo: "imagem"; img: PDFImage; x: number; y: number; w: number; h: number };

/** O plano de UMA peça, em pontos, no espaço do DESENHO (origem embaixo à esquerda, altura = área de desenho). */
function planoDaPeca(
  modelo: Modelo,
  dados: DadosEtiqueta,
  normal: PDFFont,
  negrito: PDFFont,
  imagens: Map<string, PDFImage>
): Op[] {
  const Hpt = areaDeDesenho(modelo).h * PT_POR_MM;
  const ops: Op[] = [];
  for (const el of modelo.elementos) {
    if (el.tipo === "texto") {
      const fonte = el.negrito ? negrito : normal;
      const medir = (t: string, pt: number) => fonte.widthOfTextAtSize(textoPdf(t), pt) / PT_POR_MM;
      const { linhas, pt } = linhasDoElemento(el, dados, medir);
      const lh = alturaDaLinhaMm(pt);
      linhas.forEach((bruta, i) => {
        const texto = textoPdf(bruta);
        if (!texto) return;
        const largura = fonte.widthOfTextAtSize(texto, pt);
        const x0 = el.x * PT_POR_MM;
        const x =
          el.alinhar === "centro"
            ? x0 + (el.w * PT_POR_MM - largura) / 2
            : el.alinhar === "dir"
              ? x0 + el.w * PT_POR_MM - largura
              : x0;
        // origem do PDF é embaixo: baseline a ~78% da linha, contada do topo
        ops.push({ tipo: "texto", texto, x, y: Hpt - (el.y + i * lh + lh * 0.78) * PT_POR_MM, pt, fonte });
      });
      continue;
    }
    if (el.tipo === "imagem") {
      const img = imagens.get(el.src);
      if (img) {
        ops.push({
          tipo: "imagem",
          img,
          x: el.x * PT_POR_MM,
          y: Hpt - (el.y + el.h) * PT_POR_MM,
          w: el.w * PT_POR_MM,
          h: el.h * PT_POR_MM,
        });
      }
      continue;
    }
    if (!ean13Valido(dados.codigo)) continue;
    for (const r of barrasEan13(dados.codigo, el.w, el.h)) {
      ops.push({
        tipo: "rect",
        x: (el.x + r.x) * PT_POR_MM,
        y: Hpt - (el.y + r.h) * PT_POR_MM,
        w: r.w * PT_POR_MM,
        h: r.h * PT_POR_MM,
      });
    }
    if (el.numero) {
      const tamanho = Math.min(6.5, (el.w * PT_POR_MM) / 13 / 0.6);
      const largura = normal.widthOfTextAtSize(dados.codigo, tamanho);
      ops.push({
        tipo: "texto",
        texto: dados.codigo,
        x: (el.x + el.w / 2) * PT_POR_MM - largura / 2,
        y: Hpt - (el.y + el.h) * PT_POR_MM - tamanho,
        pt: tamanho,
        fonte: normal,
      });
    }
  }
  return ops;
}

/**
 * Desenha o plano de uma peça na coluna `c` da página. A matriz leva o
 * espaço do desenho para o espaço da página: deslocamento da coluna e, na
 * etiqueta girada, rotação de 90° no sentido horário (o eixo x do desenho
 * passa a descer pela etiqueta; o topo do desenho vira a borda direita).
 */
function desenharColuna(page: PDFPage, modelo: Modelo, c: number, ops: Op[]) {
  const preto = rgb(0.07, 0.07, 0.07);
  const x0 = xDaColuna(modelo, c) * PT_POR_MM;
  const Hpt = modelo.alturaMm * PT_POR_MM;
  page.pushOperators(
    pushGraphicsState(),
    modelo.girada
      ? concatTransformationMatrix(0, -1, 1, 0, x0, Hpt)
      : concatTransformationMatrix(1, 0, 0, 1, x0, 0)
  );
  for (const op of ops) {
    if (op.tipo === "texto") page.drawText(op.texto, { x: op.x, y: op.y, size: op.pt, font: op.fonte, color: preto });
    else if (op.tipo === "imagem") page.drawImage(op.img, { x: op.x, y: op.y, width: op.w, height: op.h });
    else page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: preto });
  }
  page.pushOperators(popGraphicsState());
}

/** As imagens do modelo, embutidas UMA vez no documento (data-URL PNG ou JPEG). */
async function embutirImagens(doc: PDFDocument, modelo: Modelo): Promise<Map<string, PDFImage>> {
  const mapa = new Map<string, PDFImage>();
  for (const el of modelo.elementos) {
    if (el.tipo !== "imagem" || mapa.has(el.src)) continue;
    try {
      const [cabecalho, b64] = el.src.split(",", 2);
      const bytes = Buffer.from(b64 ?? "", "base64");
      const img = cabecalho.includes("image/png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      mapa.set(el.src, img);
    } catch {
      // imagem que o PDF não entende fica de fora (a etiqueta sai sem ela)
    }
  }
  return mapa;
}

export async function pdfDoLote(
  modelo: Modelo,
  lote: { dados: DadosEtiqueta; quantidade: number }[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const imagens = await embutirImagens(doc, modelo);
  const Wpt = larguraDaLinha(modelo) * PT_POR_MM;
  const Hpt = modelo.alturaMm * PT_POR_MM;

  // o plano é por PEÇA (mesmos dados = mesmo desenho), montado uma vez
  const planos = new Map<string, Op[]>();
  const planoDe = (d: DadosEtiqueta) => {
    const chave = JSON.stringify(d);
    let p = planos.get(chave);
    if (!p) {
      p = planoDaPeca(modelo, d, normal, negrito, imagens);
      planos.set(chave, p);
    }
    return p;
  };

  for (const linha of linhasDoRolo(expandirLote(lote, TETO_ETIQUETAS_POR_PDF), modelo.colunas)) {
    const page = doc.addPage([Wpt, Hpt]);
    linha.forEach((dados, c) => desenharColuna(page, modelo, c, planoDe(dados)));
  }
  return doc.save();
}
