import type { Posicionamento, Risco } from "./types";

/**
 * Desenho do risco em SVG — é o que o lojista vê e aprova na tela antes
 * de mandar pra plotter.
 *
 * Cores POR MODELO (pedido do lojista): num corte misto, cada modelo tem
 * a sua cor — bate o olho e já sabe de quem é cada peça. Corte de um
 * modelo só usa uma cor única (o contorno escuro separa as peças).
 * Rótulos proporcionais à peça (nunca vazam — legibilidade é bônus) e
 * régua de metragem na borda pra dar noção do espaço usado.
 */

const PALETA = [
  "#4F9DDE", "#5FBF77", "#E8A13C", "#C96FB0",
  "#7A6FF0", "#4FC3C8", "#D9705E", "#8FA84B",
];

/** Cor determinística pelo MODELO da peça (o sufixo "· MODELO" do nome). */
function corDaPeca(nome: string): string {
  const modelo = nome.includes("·") ? nome.split("·").pop()!.trim() : "";
  let h = 0;
  for (let i = 0; i < modelo.length; i++) h = (h * 31 + modelo.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * Desenha uma peça com o risco DEITADO na tela (comprimento na horizontal).
 * O encaixe trabalha com x na largura do tecido e y no comprimento; aqui
 * aplicamos uma ROTAÇÃO verdadeira de 90° — (x, y) → (y, L − x) — nunca
 * uma troca de eixos, que espelharia a peça (fio e costura errados).
 */
function pecaSvg(
  p: Posicionamento,
  larguraCm: number,
  escala: number,
  padX: number,
  padY: number
): string {
  // marker (mx, my) → tela (my, largura − mx)
  const telaX = (my: number) => padX + my * escala;
  const telaY = (mx: number) => padY + (larguraCm - mx) * escala;

  const cor = corDaPeca(p.nome);
  const partes: string[] = [];

  if (p.contorno && p.contorno.length >= 3) {
    const pts = p.contorno
      .map(([cx, cy]) => {
        const rx = p.rot === 180 ? p.w - cx : cx;
        const ry = p.rot === 180 ? p.h - cy : cy;
        return `${telaX(p.y + ry).toFixed(1)},${telaY(p.x + rx).toFixed(1)}`;
      })
      .join(" ");
    partes.push(
      `<polygon points="${pts}" fill="${cor}" fill-opacity="0.8" stroke="#1e293b" stroke-width="1"/>`
    );
  } else {
    partes.push(
      `<rect x="${telaX(p.y).toFixed(1)}" y="${telaY(p.x + p.w).toFixed(1)}" width="${(p.h * escala).toFixed(1)}" height="${(p.w * escala).toFixed(1)}" rx="3" fill="${cor}" fill-opacity="0.8" stroke="#1e293b" stroke-width="1"/>`
    );
  }

  // rótulo SEMPRE dentro da peça: o tamanho da fonte respeita a caixa da
  // peça e o comprimento do texto (peça pequena = letra pequena; vazar, nunca)
  const pwTela = p.h * escala; // largura da peça NA TELA (deitada)
  const phTela = p.w * escala; // altura da peça NA TELA
  const nome = p.nome.includes("·") ? p.nome.split("·")[0].trim() : p.nome;
  const chars = Math.max(nome.length, p.tamanho.trim().length + 1, 3);
  const fs = Math.min(12, (pwTela * 0.9) / (chars * 0.62), phTela / 3.4);
  if (fs >= 2.4) {
    const cx = telaX(p.y + p.h / 2);
    const cy = telaY(p.x + p.w / 2);
    partes.push(
      `<text x="${cx.toFixed(1)}" y="${(cy - fs * 0.2).toFixed(1)}" font-size="${fs.toFixed(1)}" fill="#fff" text-anchor="middle" font-weight="bold">${esc(nome)}</text>`,
      `<text x="${cx.toFixed(1)}" y="${(cy + fs).toFixed(1)}" font-size="${(fs * 0.85).toFixed(1)}" fill="#fff" text-anchor="middle">${esc(p.tamanho.trim())}</text>`
    );
  }
  return partes.join("");
}

/** Régua de metragem na borda de cima: tracinho a cada 10cm, número por metro. */
function regua(comprimentoCm: number, escala: number, padX: number, padY: number): string {
  const partes: string[] = [];
  const yBase = padY - 4;
  partes.push(
    `<line x1="${padX}" y1="${yBase}" x2="${(padX + comprimentoCm * escala).toFixed(1)}" y2="${yBase}" stroke="#94a3b8" stroke-width="1"/>`
  );
  for (let cm = 0; cm <= comprimentoCm; cm += 10) {
    const x = padX + cm * escala;
    const metro = cm % 100 === 0;
    const meio = cm % 50 === 0;
    const alt = metro ? 9 : meio ? 6 : 3;
    partes.push(
      `<line x1="${x.toFixed(1)}" y1="${yBase}" x2="${x.toFixed(1)}" y2="${(yBase - alt).toFixed(1)}" stroke="#94a3b8" stroke-width="1"/>`
    );
    if (metro && cm > 0)
      partes.push(
        `<text x="${x.toFixed(1)}" y="${(yBase - 12).toFixed(1)}" font-size="10" fill="#64748b" text-anchor="middle" font-weight="600">${cm / 100}m</text>`
      );
  }
  // marca final com o comprimento exato do risco
  const xFim = padX + comprimentoCm * escala;
  partes.push(
    `<line x1="${xFim.toFixed(1)}" y1="${yBase}" x2="${xFim.toFixed(1)}" y2="${(yBase - 9).toFixed(1)}" stroke="#dc2626" stroke-width="1.5"/>`,
    `<text x="${xFim.toFixed(1)}" y="${(yBase - 12).toFixed(1)}" font-size="10" fill="#dc2626" text-anchor="middle" font-weight="700">${(comprimentoCm / 100).toFixed(2)}m</text>`
  );
  return partes.join("");
}

/** SVG completo de um risco (tecido deitado: largura na vertical). */
export function riscoParaSvg(risco: Risco): string {
  const padX = 24;
  const padY = 40; // espaço da régua
  // escala pra caber ~900px de largura de tela
  const escala = Math.min(4, 900 / Math.max(1, risco.comprimentoCm));
  const w = risco.comprimentoCm * escala + padX * 2;
  const h = risco.larguraCm * escala + padY + 24 + 22;

  const partes: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" font-family="Inter, Arial, sans-serif">`,
    `<rect width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="#ffffff"/>`,
    regua(risco.comprimentoCm, escala, padX, padY),
    // o "pano": risco desenhado deitado (comprimento na horizontal)
    `<rect x="${padX}" y="${padY}" width="${(risco.comprimentoCm * escala).toFixed(1)}" height="${(risco.larguraCm * escala).toFixed(1)}" fill="#f6f3ec" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="7 4"/>`,
  ];

  for (const p of risco.pecas) partes.push(pecaSvg(p, risco.larguraCm, escala, padX, padY));

  const combo =
    risco.rotulo ??
    Object.entries(risco.combo)
      .map(([t, v]) => (v > 1 ? `${v}× ${t.trim()}` : t.trim()))
      .join(" + ");
  partes.push(
    `<text x="${padX}" y="${(h - 8).toFixed(0)}" font-size="13" fill="#334155" font-weight="600">${esc(combo)} · ${(risco.comprimentoCm / 100).toFixed(2)}m × ${(risco.larguraCm / 100).toFixed(2)}m · ${risco.folhas} folha(s) · aproveitamento ${risco.aproveitamento.toFixed(0)}%</text>`,
    `</svg>`
  );
  return partes.join("");
}
