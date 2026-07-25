import { inflateSync } from "zlib";
import type { Contorno } from "./types";

/**
 * Leitor do PDF vetorial exportado pelo Audaces Moldes (Arquivo → Exportar
 * → Exportar PDF). O Audaces desenha cada peça como polilinha fechada
 * (caminhos m/l/h) dentro de blocos posicionados (q/cm/Q) — as CURVAS
 * REAIS do molde, achatadas em segmentos finos. Nomes/tamanhos vêm como
 * letras desenhadas (não texto), então a identificação de quem é quem é
 * feita depois, pelo CASAMENTO POR MEDIDAS com o .adsx (lib casamento.ts).
 *
 * O que filtramos fora: molduras retangulares por tamanho, réguas e as
 * letras (traçados com poucos pontos / muito pequenos).
 */

const PT_CM = 2.54 / 72; // 1 ponto PDF = 0,03528 cm

export type ContornoPdf = {
  w: number; // cm
  h: number; // cm
  area: number; // cm²
  contorno: Contorno; // origem no canto da peça, eixo y pra baixo
};

type Matriz = [number, number, number, number, number, number];

const mult = (m: Matriz, n: Matriz): Matriz => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

/** Extrai e descompacta todos os content streams do PDF. */
function streamsDoPdf(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  const marca = Buffer.from("stream");
  const fim = Buffer.from("endstream");
  while (i < buf.length) {
    const s = buf.indexOf(marca, i);
    if (s < 0) break;
    let inicio = s + marca.length;
    if (buf[inicio] === 0x0d) inicio++;
    if (buf[inicio] === 0x0a) inicio++;
    const e = buf.indexOf(fim, inicio);
    if (e < 0) break;
    const bruto = buf.subarray(inicio, e);
    try {
      out.push(inflateSync(bruto).toString("latin1"));
    } catch {
      out.push(bruto.toString("latin1")); // stream sem compressão
    }
    i = e + fim.length;
  }
  return out;
}

export function parsePdfContornos(buf: Buffer): ContornoPdf[] {
  const conteudo = streamsDoPdf(buf).join("\n");
  if (!conteudo.includes(" m") && !conteudo.includes("\nm"))
    throw new Error("O PDF não tem desenho vetorial — exporte pelo Audaces Moldes (Exportar PDF)");

  // interpretador mínimo: pilha gráfica + caminhos m/l/h
  let ctm: Matriz = [1, 0, 0, 1, 0, 0];
  const pilha: Matriz[] = [];
  const nums: number[] = [];
  let atual: { pts: [number, number][]; fechado: boolean } | null = null;
  const caminhos: { pts: [number, number][]; fechado: boolean }[] = [];

  const aplica = (x: number, y: number): [number, number] => [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ];
  const fechaAtual = () => {
    if (atual && atual.pts.length > 1) caminhos.push(atual);
    atual = null;
  };

  for (const tok of conteudo.split(/\s+/)) {
    const n = Number(tok);
    if (Number.isFinite(n) && tok !== "") {
      nums.push(n);
      continue;
    }
    switch (tok) {
      case "q":
        pilha.push(ctm);
        break;
      case "Q":
        ctm = pilha.pop() ?? [1, 0, 0, 1, 0, 0];
        break;
      case "cm":
        if (nums.length >= 6) ctm = mult(ctm, nums.slice(-6) as Matriz);
        break;
      case "m":
        fechaAtual();
        if (nums.length >= 2)
          atual = { pts: [aplica(nums[nums.length - 2], nums[nums.length - 1])], fechado: false };
        break;
      case "l":
        if (atual && nums.length >= 2)
          atual.pts.push(aplica(nums[nums.length - 2], nums[nums.length - 1]));
        break;
      case "h":
        if (atual) {
          atual.fechado = true;
          fechaAtual();
        }
        break;
    }
    nums.length = 0;
  }
  fechaAtual();

  // caminhos → peças: só polilinhas FECHADAS, com curva de verdade
  // (>20 pontos descarta molduras/réguas) e tamanho de peça de roupa
  const pecas: ContornoPdf[] = [];
  for (const c of caminhos) {
    if (!c.fechado || c.pts.length <= 20) continue;
    const xs = c.pts.map((p) => p[0]);
    const ys = c.pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxY = Math.max(...ys);
    const w = (Math.max(...xs) - minX) * PT_CM;
    const h = (maxY - Math.min(...ys)) * PT_CM;
    if (Math.min(w, h) < 5 || w * h < 200) continue; // letras, piques, ruído

    // origem no canto e eixo Y invertido (PDF cresce pra cima; nós, pra
    // baixo) — MESMA transformação pra toda peça: nada espelha sozinho.
    const contorno: Contorno = c.pts.map(([x, y]) => [
      Math.round((x - minX) * PT_CM * 100) / 100,
      Math.round((maxY - y) * PT_CM * 100) / 100,
    ]);
    let area = 0;
    for (let i = 0; i < contorno.length; i++) {
      const [x1, y1] = contorno[i];
      const [x2, y2] = contorno[(i + 1) % contorno.length];
      area += x1 * y2 - x2 * y1;
    }
    pecas.push({
      w: Math.round(w * 100) / 100,
      h: Math.round(h * 100) / 100,
      area: Math.round(Math.abs(area) / 2),
      contorno,
    });
  }

  if (pecas.length === 0)
    throw new Error("Não achei contornos de peça no PDF — confira se exportou o modelo certo");
  return pecas;
}
