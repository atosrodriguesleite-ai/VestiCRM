/**
 * PRÉVIA DA ETIQUETA EM SVG (RN-059). Regra pura, roda no navegador.
 *
 * É a mesma lista de elementos do ZPL e do PDF, desenhada em milímetros
 * (viewBox em mm): o que a lojista vê em Configurações e no modal de
 * impressão é o que sai da impressora, dentro do que a estimativa de largura
 * de texto permite (o PDF mede com a fonte de verdade).
 */

import { barrasEan13, ean13Valido } from "./ean13";
import {
  encaixarTexto,
  estimarLarguraMm,
  valorDoCampo,
  MM_POR_PT,
  type DadosEtiqueta,
  type Modelo,
} from "./modelo";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function svgDaEtiqueta(modelo: Modelo, dados: DadosEtiqueta): string {
  const W = modelo.larguraMm;
  const H = modelo.alturaMm;
  const partes: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="Helvetica, Arial, sans-serif">`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#cbd5e1" stroke-width="0.2"/>`,
  ];
  for (const el of modelo.elementos) {
    if (el.tipo === "texto") {
      const bruto = valorDoCampo(el, dados);
      if (!bruto) continue;
      const { texto, pt } = encaixarTexto(bruto, el.w, el.pt, estimarLarguraMm);
      const tamanhoMm = pt * MM_POR_PT;
      const anchor = el.alinhar === "centro" ? "middle" : el.alinhar === "dir" ? "end" : "start";
      const x = el.alinhar === "centro" ? el.x + el.w / 2 : el.alinhar === "dir" ? el.x + el.w : el.x;
      const y = el.y + el.h * 0.78;
      partes.push(
        `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${tamanhoMm.toFixed(2)}" text-anchor="${anchor}"${el.negrito ? ' font-weight="bold"' : ""} fill="#111">${esc(texto)}</text>`
      );
      continue;
    }
    if (!ean13Valido(dados.codigo)) continue;
    for (const r of barrasEan13(dados.codigo, el.w, el.h)) {
      partes.push(
        `<rect x="${(el.x + r.x).toFixed(3)}" y="${el.y.toFixed(2)}" width="${r.w.toFixed(3)}" height="${r.h.toFixed(2)}" fill="#111"/>`
      );
    }
    if (el.numero) {
      // o número embaixo, em fonte que caiba nos 13 dígitos
      const tamanhoMm = Math.min(2.2, (el.w / 13) * 0.9);
      partes.push(
        `<text x="${(el.x + el.w / 2).toFixed(2)}" y="${(el.y + el.h + tamanhoMm).toFixed(2)}" font-size="${tamanhoMm.toFixed(2)}" text-anchor="middle" fill="#111" letter-spacing="0.3">${dados.codigo}</text>`
      );
    }
  }
  partes.push(`</svg>`);
  return partes.join("");
}
