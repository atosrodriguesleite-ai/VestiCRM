// Guarda RN-089
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COR_DA_SERIE,
  RAMPA_ORDINAL,
  RAMPA_ORDINAL_ESCURA,
  SUPERFICIE,
  SUPERFICIE_ESCURA,
  LARGURA_DO_EIXO,
  contraste,
  conversaoDoFunil,
  corDoFunil,
  degrauDoFunil,
  estiloDoFunil,
  formatarValor,
  geometriaDaSerie,
  indiceMaisPerto,
  posicaoDoBalao,
} from "../bi/paleta";

/**
 * RN-089 — a paleta do BI é VALIDADA, não escolhida a olho: a cor da série
 * tem ≥ 3:1 sobre as DUAS superfícies; a rampa do funil é de um matiz,
 * clara → escura, e o degrau mais claro fica ≥ 2:1 (a rampa antiga começava
 * a 1,81:1); o tema escuro tem rampa PRÓPRIA (o espresso da clara sumia a
 * 1,22:1 sobre #241c13); os tokens do CSS são os mesmos valores da lib; a
 * conversão do funil é por etapa; a mira acha o ponto mais perto; os rótulos
 * não colidem.
 */

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
/** o valor de um token dentro de um bloco do CSS (`@theme`, `:root` ou `.theme-dark`) — o primeiro bloco com esse nome que o declara */
function token(bloco: string, nome: string): string | undefined {
  const re = new RegExp(`^${bloco.replace(".", "\\.")} \\{\\n([\\s\\S]*?)\\n\\}`, "gm");
  for (const m of css.matchAll(re)) {
    const v = m[1].match(new RegExp(`${nome}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
    if (v) return v;
  }
  return undefined;
}

describe("a paleta", () => {
  it("a cor da série tem contraste ≥ 3:1 sobre a superfície clara E a escura", () => {
    expect(contraste(COR_DA_SERIE, SUPERFICIE)).toBeGreaterThanOrEqual(3);
    expect(contraste(COR_DA_SERIE, SUPERFICIE_ESCURA)).toBeGreaterThanOrEqual(3);
    // a conta é a do WCAG: preto sobre branco é 21:1
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });
  it("as superfícies da lib são as do app (globals.css)", () => {
    expect(token("@theme", "--color-surface")).toBe(SUPERFICIE);
    expect(token(".theme-dark", "--color-surface")).toBe(SUPERFICIE_ESCURA);
  });
  it("a rampa clara escurece degrau a degrau e o mais claro ainda clareia ≥ 2:1 sobre a superfície", () => {
    const contrastes = RAMPA_ORDINAL.map((c) => contraste(c, SUPERFICIE));
    for (let i = 1; i < contrastes.length; i++) expect(contrastes[i]).toBeGreaterThan(contrastes[i - 1]);
    expect(contrastes[0]).toBeGreaterThanOrEqual(2);
    // o ocre claro da rampa antiga (#dbba8b) reprova — é por isso que o funil não começa nele
    expect(contraste("#dbba8b", SUPERFICIE)).toBeLessThan(2);
  });
  it("o tema escuro tem rampa PRÓPRIA: todo degrau ≥ 2:1 sobre #241c13 — a clara invertida não serve", () => {
    const contrastes = RAMPA_ORDINAL_ESCURA.map((c) => contraste(c, SUPERFICIE_ESCURA));
    for (const c of contrastes) expect(c).toBeGreaterThanOrEqual(2);
    // o espresso da rampa clara some no escuro
    expect(contraste(RAMPA_ORDINAL[3], SUPERFICIE_ESCURA)).toBeLessThan(2);
  });
  it("os tokens --gv-funil-N do CSS são os valores da lib, no claro e no escuro (o funil pinta pelo token)", () => {
    RAMPA_ORDINAL.forEach((cor, i) => expect(token(":root", `--gv-funil-${i + 1}`)).toBe(cor));
    RAMPA_ORDINAL_ESCURA.forEach((cor, i) => expect(token(".theme-dark", `--gv-funil-${i + 1}`)).toBe(cor));
  });
  it("corDoFunil devolve o token da etapa: 4 etapas = 4 degraus; menos usa os primeiros", () => {
    expect([0, 1, 2, 3].map((i) => corDoFunil(i, 4))).toEqual(["var(--gv-funil-1)", "var(--gv-funil-2)", "var(--gv-funil-3)", "var(--gv-funil-4)"]);
    expect([0, 1].map((i) => corDoFunil(i, 2))).toEqual(["var(--gv-funil-1)", "var(--gv-funil-2)"]);
  });
  it("funil com MAIS de 4 etapas (Relatórios tem 9): cada etapa tem cor própria, interpolada entre degraus vizinhos no mesmo matiz — nunca três seguidas iguais", () => {
    for (const n of [5, 6, 8, 9]) {
      const cores = Array.from({ length: n }, (_, i) => corDoFunil(i, n));
      expect(new Set(cores).size).toBe(n);
      expect(cores[0]).toBe("var(--gv-funil-1)");
      expect(cores[n - 1]).toBe("var(--gv-funil-4)");
      // monótona: o degrau de reserva nunca volta
      const degraus = Array.from({ length: n }, (_, i) => degrauDoFunil(i, n));
      for (let i = 1; i < n; i++) expect(degraus[i]).toBeGreaterThanOrEqual(degraus[i - 1]);
    }
    expect(corDoFunil(1, 9)).toBe("color-mix(in oklab, var(--gv-funil-1) 62%, var(--gv-funil-2))");
    expect(corDoFunil(4, 9)).toBe("color-mix(in oklab, var(--gv-funil-2) 50%, var(--gv-funil-3))");
  });
  it("estiloDoFunil leva a reserva por variável (o navegador sem color-mix cai no degrau inteiro pela classe .gv-funil)", () => {
    expect(estiloDoFunil(1, 9)).toEqual({ "--gv-funil-base": "var(--gv-funil-1)", backgroundColor: "color-mix(in oklab, var(--gv-funil-1) 62%, var(--gv-funil-2))" });
    expect(estiloDoFunil(3, 4)).toEqual({ "--gv-funil-base": "var(--gv-funil-4)", backgroundColor: "var(--gv-funil-4)" });
    expect(css).toMatch(/\.gv-funil \{\n\s*background-color: var\(--gv-funil-base/);
  });
});

describe("as contas dos gráficos", () => {
  it("conversão do funil: % da anterior e % do começo, nulos sem base", () => {
    expect(conversaoDoFunil([{ label: "a", value: 40 }, { label: "b", value: 20 }, { label: "c", value: 5 }, { label: "d", value: 0 }])).toEqual([
      { daAnterior: null, daPrimeira: null },
      { daAnterior: 50, daPrimeira: 50 },
      { daAnterior: 25, daPrimeira: 13 },
      { daAnterior: 0, daPrimeira: 0 },
    ]);
    expect(conversaoDoFunil([{ label: "a", value: 0 }, { label: "b", value: 0 }])[1]).toEqual({ daAnterior: null, daPrimeira: null });
  });
  it("a mira: o ponto mais perto da posição, preso nas bordas", () => {
    expect([indiceMaisPerto(0, 10), indiceMaisPerto(0.5, 10), indiceMaisPerto(1, 10), indiceMaisPerto(-1, 10), indiceMaisPerto(2, 10)]).toEqual([0, 5, 9, 0, 9]);
    expect(indiceMaisPerto(0.9, 1)).toBe(0);
  });
  it("o balão se ancora pelo lado de dentro perto das bordas", () => {
    expect([posicaoDoBalao(0.1), posicaoDoBalao(0.5), posicaoDoBalao(0.9)]).toEqual(["esquerda", "centro", "direita"]);
  });
  it("o formato é serializável (atravessa servidor → navegador) e o dinheiro é o `brl` da casa: inteiro sem centavos, quebrado com", () => {
    expect(formatarValor(3)).toBe("3");
    expect(formatarValor(1234, "brl").replace(/ /g, " ")).toBe("R$ 1.234");
    expect(formatarValor(1234.5, "brl").replace(/ /g, " ")).toBe("R$ 1.234,50");
    expect(formatarValor(3, { pctDe: 12 })).toBe("3 (25%)");
    expect(formatarValor(3, { pctDe: 0 })).toBe("3 (0%)");
  });
  it("a geometria da série: o rótulo do último ponto sai quando colide com o do pico; série vazia não quebra", () => {
    const perto = geometriaDaSerie([1, 2, 9, 3], { larguraDoRotulo: () => 400 });
    expect(perto.maxIdx).toBe(2);
    expect(perto.rotulos.map((r) => r.i)).toEqual([2]);
    const longe = geometriaDaSerie([9, 1, 1, 1, 1, 1, 1, 1, 1, 2], { larguraDoRotulo: () => 60 });
    expect(longe.rotulos.map((r) => r.i)).toEqual([0, 9]);
    const vazia = geometriaDaSerie([]);
    expect([vazia.n, vazia.maxIdx, vazia.rotulos, vazia.area]).toEqual([0, -1, [], ""]);
  });
  it("o rótulo é PRESO dentro da área: o pico no primeiro ponto não sai pela esquerda, o último não sai pela direita", () => {
    const g = geometriaDaSerie([9, 1, 1, 8], { larguraDoRotulo: () => 60 });
    const [pico, ultimo] = g.rotulos;
    expect(pico.i).toBe(0);
    expect(pico.x).toBeGreaterThanOrEqual(30); // metade da largura
    expect(ultimo.x).toBeLessThanOrEqual(600 - 30);
    // e a colisão é pela posição presa: pico e último que escorregam para a mesma borda viram um só
    const colados = geometriaDaSerie([9, 8], { larguraDoRotulo: () => 1000 });
    expect(colados.rotulos.map((r) => r.i)).toEqual([0]);
  });
  it("o eixo: até ~6 rótulos, sempre o último, e o vizinho que encostaria no último sai", () => {
    const trinta = geometriaDaSerie(Array(30).fill(1));
    expect(trinta.eixo).toContain(29);
    expect(trinta.eixo.length).toBeLessThanOrEqual(7);
    // 12 pontos: 0,2,4,6,8,10 e o 11 — o 10 fica a um passo (≈53px) do 11 e passa; numa largura curta ele sai
    const doze = geometriaDaSerie(Array(12).fill(1));
    expect(doze.eixo).toEqual([0, 2, 4, 6, 8, 10, 11]);
    const estreita = geometriaDaSerie(Array(12).fill(1), { w: 200 });
    expect(estreita.eixo).toEqual([0, 2, 4, 6, 8, 11]);
    expect((doze.step * 1) >= LARGURA_DO_EIXO).toBe(true);
  });
});
