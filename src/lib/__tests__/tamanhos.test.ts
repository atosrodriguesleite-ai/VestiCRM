import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ordenarTamanhos, ordenarVariantes, compararTamanhos } from "../tamanhos";

/**
 * A RÉGUA ÚNICA DOS TAMANHOS (12/08/2026): toda tela mostra a grade na ordem
 * de roupa — PP, P, M, G, GG e numeração crescente — nunca no alfabeto (onde
 * o G vinha antes do M).
 */

describe("ordem de roupa em todas as listas", () => {
  it("letras: PP < P < M < G < GG (o caso da tela do produto)", () => {
    expect(ordenarTamanhos(["G", "GG", "M", "P", "PP"])).toEqual(["PP", "P", "M", "G", "GG"]);
  });
  it("numeração: 32 < 33 < 34 (e 9 < 10 — número, não texto)", () => {
    expect(ordenarTamanhos(["34", "32", "33"])).toEqual(["32", "33", "34"]);
    expect(compararTamanhos("9", "10")).toBeLessThan(0);
  });
  it("misturado: letras antes da numeração; Único no fim", () => {
    expect(ordenarTamanhos(["38", "M", "Único", "PP", "36"])).toEqual([
      "PP",
      "M",
      "36",
      "38",
      "Único",
    ]);
  });
});

describe("a grade de variações segue cor e depois o tamanho de roupa", () => {
  it("o exemplo real da tela: Azul Marinho G, GG, M, P vira P, M, G, GG", () => {
    const grade = [
      { color: "Azul Marinho", size: "G" },
      { color: "Azul Marinho", size: "GG" },
      { color: "Azul Marinho", size: "M" },
      { color: "Azul Marinho", size: "P" },
      { color: "Amarelo", size: "PP" },
    ];
    expect(ordenarVariantes(grade).map((v) => `${v.color}·${v.size}`)).toEqual([
      "Amarelo·PP",
      "Azul Marinho·P",
      "Azul Marinho·M",
      "Azul Marinho·G",
      "Azul Marinho·GG",
    ]);
  });
});

describe("as telas usam a régua", () => {
  const ler = (rel: string) => readFileSync(rel, "utf8");
  it("Produtos: grade, filtro de tamanhos e biblioteca", () => {
    const pg = ler("src/app/(app)/produtos/page.tsx");
    expect(pg).toContain("ordenarVariantes(p.variants)");
    expect(pg).toContain("ordenarTamanhos([");
    expect(pg).toContain("compararTamanhos(a.name, b.name)");
  });
  it("catálogo público: bolinhas de tamanho na ordem da arara", () => {
    expect(ler("src/app/catalogo/[slug]/page.tsx")).toContain("ordenarVariantes(p.variants)");
  });
  it("seletores de pedido (API de produtos)", () => {
    expect(ler("src/app/api/products/route.ts")).toContain("ordenarVariantes(p.variants)");
  });
  it("Personalizar catálogo: biblioteca respeita a ordem escolhida, roupa no desempate", () => {
    expect(ler("src/app/(app)/configuracoes/catalogo/page.tsx")).toContain("compararTamanhos");
  });
  it("o romaneio usa a MESMA régua (fonte única)", () => {
    expect(ler("src/lib/romaneio.ts")).toContain('from "./tamanhos"');
  });
});
