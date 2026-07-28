import { describe, it, expect } from "vitest";
import { CARTELA, normalizarHex } from "../paleta";

/**
 * A lojista digita cor do jeito que vier: com #, sem #, com espaço, em
 * maiúscula, no atalho de 3 dígitos. Se o campo só aceitasse a forma
 * "correta", ela ia achar que o sistema não funciona.
 */

describe("código da cor digitado à mão", () => {
  it("aceita com e sem cerquilha", () => {
    expect(normalizarHex("#C94F7C")).toBe("#C94F7C");
    expect(normalizarHex("c94f7c")).toBe("#C94F7C");
  });

  it("ignora espaço sobrando (copiar-colar do manual da marca)", () => {
    expect(normalizarHex("  #c94f7c  ")).toBe("#C94F7C");
  });

  it("entende o atalho de 3 dígitos", () => {
    expect(normalizarHex("#f0a")).toBe("#FF00AA");
  });

  it("recusa o que não é cor, sem quebrar a tela", () => {
    expect(normalizarHex("rosa bebê")).toBeNull();
    expect(normalizarHex("#12345")).toBeNull();
    expect(normalizarHex("")).toBeNull();
  });
});

describe("cartela de moda", () => {
  it("todo tom tem nome e código válido", () => {
    for (const grupo of CARTELA) {
      expect(grupo.tons.length).toBeGreaterThan(0);
      for (const [nome, hex] of grupo.tons) {
        expect(nome.trim().length).toBeGreaterThan(2);
        expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it("não repete o mesmo tom em lugares diferentes", () => {
    const todos = CARTELA.flatMap((g) => g.tons.map(([, hex]) => hex.toUpperCase()));
    expect(new Set(todos).size).toBe(todos.length);
  });
});
