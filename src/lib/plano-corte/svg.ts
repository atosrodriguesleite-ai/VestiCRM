import type { Posicionamento, Risco } from "./types";

/**
 * Desenho do risco em SVG — é o que o lojista vê e aprova na tela antes
 * de mandar pra plotter. Cores estáveis por nome de peça (a FRENTE é
 * sempre da mesma cor em qualquer risco), rótulo com nome + tamanho.
 */

const PALETA = [
  "#4F9DDE", "#5FBF77", "#E8A13C", "#C96FB0",
  "#7A6FF0", "#4FC3C8", "#D9705E", "#8FA84B",
];

/** Cor determinística pelo nome da peça. */
function corDaPeca(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function pecaSvg(p: Posicionamento, escala: number, pad: number): string {
  const px = pad + p.x * escala;
  const py = pad + p.y * escala;
  const pw = p.w * escala;
  const ph = p.h * escala;
  const cor = corDaPeca(p.nome);
  const partes: string[] = [];

  if (p.contorno && p.contorno.length >= 3) {
    // curva real: aplica rotação 180° dentro da caixa quando for o caso
    const pts = p.contorno
      .map(([cx, cy]) => {
        const rx = p.rot === 180 ? p.w - cx : cx;
        const ry = p.rot === 180 ? p.h - cy : cy;
        return `${(px + rx * escala).toFixed(1)},${(py + ry * escala).toFixed(1)}`;
      })
      .join(" ");
    partes.push(
      `<polygon points="${pts}" fill="${cor}" fill-opacity="0.8" stroke="#1e293b" stroke-width="1"/>`
    );
  } else {
    partes.push(
      `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="3" fill="${cor}" fill-opacity="0.8" stroke="#1e293b" stroke-width="1"/>`
    );
  }

  const fs = Math.max(8, Math.min(14, pw / 7));
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  partes.push(
    `<text x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}" font-size="${fs.toFixed(0)}" fill="#fff" text-anchor="middle" font-weight="bold">${esc(p.nome)}</text>`,
    `<text x="${cx.toFixed(1)}" y="${(cy + fs).toFixed(1)}" font-size="${(fs * 0.85).toFixed(0)}" fill="#fff" text-anchor="middle">${esc(p.tamanho)}</text>`
  );
  return partes.join("");
}

/** SVG completo de um risco (tecido deitado: largura na vertical). */
export function riscoParaSvg(risco: Risco): string {
  const pad = 24;
  // escala pra caber ~900px de largura de tela
  const escala = Math.min(4, 900 / Math.max(1, risco.comprimentoCm));
  const w = risco.comprimentoCm * escala + pad * 2;
  const h = risco.larguraCm * escala + pad * 2 + 22;

  const partes: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" font-family="Inter, Arial, sans-serif">`,
    `<rect width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#ffffff"/>`,
    // o "pano": risco desenhado deitado (comprimento na horizontal)
    `<rect x="${pad}" y="${pad}" width="${(risco.comprimentoCm * escala).toFixed(1)}" height="${(risco.larguraCm * escala).toFixed(1)}" fill="#f6f3ec" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="7 4"/>`,
  ];

  // peças (x do encaixe = largura do tecido → vira eixo Y do desenho deitado)
  for (const p of risco.pecas) {
    const deitada: Posicionamento = { ...p, x: p.y, y: p.x, w: p.h, h: p.w };
    // girar o desenho 90° pra apresentação exige trocar contorno também
    if (p.contorno)
      deitada.contorno = p.contorno.map(([cx, cy]) => [cy, cx] as [number, number]);
    partes.push(pecaSvg(deitada, escala, pad));
  }

  const combo = Object.entries(risco.combo)
    .map(([t, v]) => (v > 1 ? `${v}× ${t}` : t))
    .join(" + ");
  partes.push(
    `<text x="${pad}" y="${(h - 8).toFixed(0)}" font-size="13" fill="#334155" font-weight="600">${esc(combo)} · ${(risco.comprimentoCm / 100).toFixed(2)}m × ${(risco.larguraCm / 100).toFixed(2)}m · ${risco.folhas} folha(s) · aproveitamento ${risco.aproveitamento.toFixed(0)}%</text>`,
    `</svg>`
  );
  return partes.join("");
}
