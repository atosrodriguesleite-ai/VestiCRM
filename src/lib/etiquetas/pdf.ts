/**
 * ETIQUETAS EM PDF, uma página por etiqueta, na MEDIDA exata (RN-059).
 *
 * É o caminho que serve para QUALQUER impressora de etiqueta pelo driver do
 * sistema (Zebra pelo ZDesigner, Elgin pelo driver dela) e para conferir na
 * tela. A mesma lista de elementos do ZPL; aqui a largura do texto é medida
 * com a fonte de verdade, então este é o desenho mais fiel.
 *
 * O PLANO de cada peça (textos já encaixados, retângulos das barras) é
 * montado UMA vez; as cópias só desenham — 500 etiquetas iguais não refazem
 * 500 vezes a conta (achado da revisão).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { textoPdf } from "@/lib/pdf-texto";
import { barrasEan13, ean13Valido } from "./ean13";
import { encaixarTexto, valorDoCampo, type DadosEtiqueta, type Modelo } from "./modelo";

const PT_POR_MM = 72 / 25.4;
/** teto de páginas num PDF só (500 etiquetas já é um rolo) */
export const TETO_ETIQUETAS_POR_PDF = 500;

type Op =
  | { tipo: "texto"; texto: string; x: number; y: number; pt: number; fonte: PDFFont }
  | { tipo: "rect"; x: number; y: number; w: number; h: number };

function planoDaPeca(modelo: Modelo, dados: DadosEtiqueta, normal: PDFFont, negrito: PDFFont, Hpt: number): Op[] {
  const ops: Op[] = [];
  for (const el of modelo.elementos) {
    if (el.tipo === "texto") {
      const bruto = textoPdf(valorDoCampo(el, dados));
      if (!bruto) continue;
      const fonte = el.negrito ? negrito : normal;
      const medir = (t: string, pt: number) => fonte.widthOfTextAtSize(t, pt) / PT_POR_MM;
      const { texto, pt } = encaixarTexto(bruto, el.w, el.pt, medir);
      const largura = fonte.widthOfTextAtSize(texto, pt);
      const x0 = el.x * PT_POR_MM;
      const x =
        el.alinhar === "centro"
          ? x0 + (el.w * PT_POR_MM - largura) / 2
          : el.alinhar === "dir"
            ? x0 + el.w * PT_POR_MM - largura
            : x0;
      // origem do PDF é embaixo: baseline a ~78% da linha, contada do topo
      ops.push({ tipo: "texto", texto, x, y: Hpt - (el.y + el.h * 0.78) * PT_POR_MM, pt, fonte });
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

function desenhar(page: PDFPage, ops: Op[]) {
  const preto = rgb(0.07, 0.07, 0.07);
  for (const op of ops) {
    if (op.tipo === "texto") page.drawText(op.texto, { x: op.x, y: op.y, size: op.pt, font: op.fonte, color: preto });
    else page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: preto });
  }
}

export async function pdfDoLote(
  modelo: Modelo,
  lote: { dados: DadosEtiqueta; quantidade: number }[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const Wpt = modelo.larguraMm * PT_POR_MM;
  const Hpt = modelo.alturaMm * PT_POR_MM;
  let total = 0;

  for (const item of lote) {
    if (item.quantidade <= 0) continue;
    const plano = planoDaPeca(modelo, item.dados, normal, negrito, Hpt);
    for (let c = 0; c < item.quantidade && total < TETO_ETIQUETAS_POR_PDF; c++) {
      total++;
      desenhar(doc.addPage([Wpt, Hpt]), plano);
    }
  }
  return doc.save();
}
