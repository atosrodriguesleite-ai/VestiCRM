/**
 * PRÉVIA DA ETIQUETA EM SVG (RN-059). Regra pura, roda no navegador.
 *
 * É a mesma lista de elementos do ZPL e do PDF, desenhada em milímetros
 * (viewBox em mm). A prévia mostra UMA LINHA do rolo — todas as colunas —,
 * e a etiqueta girada aparece girada, como sai da impressora: o que a
 * lojista vê em Configurações é o que sai.
 */

import { barrasEan13, ean13Valido } from "./ean13";
import {
  areaDeDesenho,
  encaixarTexto,
  estimarLarguraMm,
  larguraDaLinha,
  valorDoCampo,
  xDaColuna,
  MM_POR_PT,
  type DadosEtiqueta,
  type Modelo,
} from "./modelo";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O conteúdo de uma etiqueta, em coordenadas do DESENHO (sem moldura). */
function conteudo(modelo: Modelo, dados: DadosEtiqueta): string {
  const partes: string[] = [];
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
      const tamanhoMm = Math.min(2.2, (el.w / 13) * 0.9);
      partes.push(
        `<text x="${(el.x + el.w / 2).toFixed(2)}" y="${(el.y + el.h + tamanhoMm).toFixed(2)}" font-size="${tamanhoMm.toFixed(2)}" text-anchor="middle" fill="#111" letter-spacing="0.3">${dados.codigo}</text>`
      );
    }
  }
  return partes.join("");
}

/** Uma LINHA do rolo: cada coluna com a sua peça (coluna sem peça sai em branco). */
export function svgDaLinha(modelo: Modelo, linha: DadosEtiqueta[]): string {
  const W = larguraDaLinha(modelo);
  const H = modelo.alturaMm;
  const partes: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="Helvetica, Arial, sans-serif">`,
  ];
  for (let c = 0; c < modelo.colunas; c++) {
    const x0 = xDaColuna(modelo, c);
    partes.push(
      `<rect x="${x0.toFixed(2)}" y="0" width="${modelo.larguraMm}" height="${H}" fill="#fff" stroke="#cbd5e1" stroke-width="0.2"/>`
    );
    const dados = linha[c];
    if (!dados) continue;
    // girada: o desenho (deitado) é levado ao canto superior direito da
    // etiqueta e girado 90° no sentido horário — o topo vira a borda direita
    const transform = modelo.girada
      ? `translate(${(x0 + modelo.larguraMm).toFixed(2)},0) rotate(90)`
      : `translate(${x0.toFixed(2)},0)`;
    partes.push(`<g transform="${transform}">${conteudo(modelo, dados)}</g>`);
  }
  partes.push(`</svg>`);
  return partes.join("");
}

/** Uma etiqueta sozinha (a prévia de uma coluna só). */
export function svgDaEtiqueta(modelo: Modelo, dados: DadosEtiqueta): string {
  return svgDaLinha({ ...modelo, colunas: 1 }, [dados]);
}

export { areaDeDesenho };
