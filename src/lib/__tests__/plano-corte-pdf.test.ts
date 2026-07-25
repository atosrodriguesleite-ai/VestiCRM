import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import { parsePdfContornos } from "../plano-corte/pdf";
import { casarCurvas } from "../plano-corte/casamento";
import type { ModeloCorte } from "../plano-corte/types";

/* ---------- fixture: PDF mínimo no estilo do Audaces ---------- */

const PT = 72 / 2.54; // cm → pontos

/** Polilinha fechada m/l/h em pontos, com muitos vértices (como o Audaces). */
function caminho(cmPts: [number, number][]): string {
  const [x0, y0] = cmPts[0];
  const linhas = cmPts.slice(1).map(([x, y]) => `${x * PT} ${y * PT} l`);
  return `${x0 * PT} ${y0 * PT} m\n${linhas.join("\n")}\nh\nS`;
}

/** "Curva" fechada com N pontos aproximando um retângulo w×h no offset. */
function pecaFake(w: number, h: number, ox: number, oy: number): [number, number][] {
  const pts: [number, number][] = [];
  const N = 12; // pontos por lado → >20 no total (passa no filtro anti-moldura)
  for (let i = 0; i < N; i++) pts.push([ox + (w * i) / N, oy]);
  for (let i = 0; i < N; i++) pts.push([ox + w, oy + (h * i) / N]);
  for (let i = 0; i < N; i++) pts.push([ox + w - (w * i) / N, oy + h]);
  for (let i = 0; i < N; i++) pts.push([ox, oy + h - (h * i) / N]);
  return pts;
}

function pdfFake(conteudo: string): Buffer {
  const stream = deflateSync(Buffer.from(conteudo, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<</Length 1>>\nstream\n"),
    stream,
    Buffer.from("\nendstream\nendobj\ntrailer\n%%EOF"),
  ]);
}

/* ---------- testes ---------- */

describe("leitor de PDF do Audaces", () => {
  it("extrai peças fechadas e filtra molduras (4 pontos) e ruído", () => {
    const conteudo = [
      "q 1 0 0 1 0 0 cm",
      caminho(pecaFake(50, 40, 10, 10)), // peça 1
      caminho(pecaFake(30, 28, 80, 10)), // peça 2
      // moldura retangular (4 pontos → deve ser filtrada)
      `${10 * PT} ${10 * PT} m ${170 * PT} ${10 * PT} l ${170 * PT} ${60 * PT} l ${10 * PT} ${60 * PT} l h S`,
      "Q",
    ].join("\n");
    const pecas = parsePdfContornos(pdfFake(conteudo));
    expect(pecas).toHaveLength(2);
    const dims = pecas.map((p) => `${p.w.toFixed(0)}x${p.h.toFixed(0)}`).sort();
    expect(dims).toEqual(["30x28", "50x40"]);
    // contorno normalizado na origem
    for (const p of pecas)
      for (const [x, y] of p.contorno) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
      }
  });

  it("tira fina (galão/gola, retângulo de 5 pontos) É peça; régua não", () => {
    const conteudo = [
      "q 1 0 0 1 0 0 cm",
      // galão 3×40cm desenhado como retângulo puro (igual o Audaces faz)
      `${10 * PT} ${10 * PT} m ${13 * PT} ${10 * PT} l ${13 * PT} ${50 * PT} l ${10 * PT} ${50 * PT} l h S`,
      // régua de borda 3×160cm (proporção extrema → fora)
      `${0 * PT} ${0 * PT} m ${3 * PT} ${0 * PT} l ${3 * PT} ${160 * PT} l ${0 * PT} ${160 * PT} l h S`,
      // moldura de tamanho 100×120cm com 4 pontos (→ fora)
      `${20 * PT} ${20 * PT} m ${120 * PT} ${20 * PT} l ${120 * PT} ${140 * PT} l ${20 * PT} ${140 * PT} l h S`,
      "Q",
    ].join("\n");
    const pecas = parsePdfContornos(pdfFake(conteudo));
    expect(pecas).toHaveLength(1);
    expect(pecas[0].w).toBeCloseTo(3, 0);
    expect(pecas[0].h).toBeCloseTo(40, 0);
  });

  it("respeita blocos q/cm/Q (peça transladada mantém o tamanho)", () => {
    const conteudo = [
      "q",
      `1 0 0 1 ${100 * PT} ${200 * PT} cm`,
      caminho(pecaFake(60, 45, 0, 0)),
      "Q",
    ].join("\n");
    const pecas = parsePdfContornos(pdfFake(conteudo));
    expect(pecas).toHaveLength(1);
    expect(pecas[0].w).toBeCloseTo(60, 0);
    expect(pecas[0].h).toBeCloseTo(45, 0);
  });

  it("PDF sem vetor vira erro claro", () => {
    expect(() => parsePdfContornos(pdfFake("BT (ola) Tj ET"))).toThrow(/vetorial|contorno/i);
  });
});

describe("casamento por medidas (.adsx + PDF)", () => {
  const modelo: ModeloCorte = {
    nome: "TESTE",
    origem: "ADSX",
    tamanhos: ["P", "M"],
    pecas: [
      {
        nome: "FRENTE",
        pano: "TEC",
        qtd: 1,
        tamanhos: {
          P: { w: 50, h: 40, area: 1500 },
          M: { w: 54, h: 42, area: 1700 },
        },
      },
      {
        nome: "FRENTE FOR",
        pano: "FOR",
        qtd: 1,
        tamanhos: { P: { w: 30, h: 28, area: 700 }, M: { w: 32, h: 30, area: 800 } },
      },
    ],
  };

  const contorno = (w: number, h: number) =>
    ({
      w,
      h,
      area: w * h * 0.8,
      contorno: [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ] as [number, number][],
    });

  it("cada curva acha sua peça×tamanho pelas medidas", () => {
    const m: ModeloCorte = JSON.parse(JSON.stringify(modelo));
    const r = casarCurvas(m, [
      contorno(50.3, 40.2), // FRENTE P (com folguinha de mm)
      contorno(54, 42), // FRENTE M
      contorno(30, 28), // FOR P
      contorno(32, 30), // FOR M
    ]);
    expect(r.casadas).toBe(4);
    expect(r.totalAlvos).toBe(4);
    expect(r.sobrando).toBe(0);
    expect(m.pecas[0].tamanhos.P.contorno).toBeDefined();
    expect(m.pecas[1].tamanhos.M.contorno).toBeDefined();
  });

  it("peça deitada no PDF casa girada (w/h trocados)", () => {
    const m: ModeloCorte = JSON.parse(JSON.stringify(modelo));
    const r = casarCurvas(m, [contorno(40, 50)]); // FRENTE P deitada
    expect(r.casadas).toBe(1);
    const c = m.pecas[0].tamanhos.P.contorno!;
    // depois de girar, a caixa do contorno volta a ser 50×40
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(50, 0);
    expect(Math.max(...ys)).toBeCloseTo(40, 0);
  });

  it("curva de outro modelo não casa (fora da tolerância)", () => {
    const m: ModeloCorte = JSON.parse(JSON.stringify(modelo));
    const r = casarCurvas(m, [contorno(90, 77)]);
    expect(r.casadas).toBe(0);
    expect(r.sobrando).toBe(1);
  });

  it("cópia duplicada (peça par) fica de sobra sem atrapalhar", () => {
    const m: ModeloCorte = JSON.parse(JSON.stringify(modelo));
    const r = casarCurvas(m, [contorno(50, 40), contorno(50, 40)]);
    expect(r.casadas).toBe(1); // só a FRENTE P existe com essa medida
    expect(r.sobrando).toBe(1); // a cópia par sobra — comportamento esperado
  });
});
