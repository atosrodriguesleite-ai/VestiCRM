import { describe, it, expect } from "vitest";
import { moverTemplate } from "../templates-ordem";

/**
 * REORDENAR RESPOSTAS RÁPIDAS (pedido do dono, 11/08/2026): a ordem era
 * alfabética e imutável — "Boas vindas", a mais usada, ficava atrás de
 * "Apresentação" e "Após envio catálogo" para sempre.
 */

const lista = [
  { id: "a", category: "OUTRO", title: "Apresentação" },
  { id: "b", category: "CATALOGO", title: "Após envio catálogo" },
  { id: "c", category: "OUTRO", title: "Boas vindas" },
  { id: "d", category: "CATALOGO", title: "Catálogo" },
];

describe("mover dentro da categoria (painel do chat)", () => {
  it("sobe pulando as respostas das outras categorias", () => {
    // "Boas vindas" (OUTRO) sobe: troca com "Apresentação" (OUTRO),
    // pulando a de CATALOGO que está no meio
    const nova = moverTemplate(lista, "c", "subir", true);
    expect(nova.map((t) => t.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("desce pulando as das outras categorias", () => {
    const nova = moverTemplate(lista, "b", "descer", true);
    expect(nova.map((t) => t.id)).toEqual(["a", "d", "c", "b"]);
  });

  it("primeira da categoria não sobe (devolve a MESMA lista)", () => {
    expect(moverTemplate(lista, "a", "subir", true)).toBe(lista);
    expect(moverTemplate(lista, "b", "subir", true)).toBe(lista);
  });

  it("última da categoria não desce", () => {
    expect(moverTemplate(lista, "c", "descer", true)).toBe(lista);
    expect(moverTemplate(lista, "d", "descer", true)).toBe(lista);
  });
});

describe("mover na lista completa (tela Configurações)", () => {
  it("troca com a vizinha imediata, mesmo de outra categoria", () => {
    const nova = moverTemplate(lista, "c", "subir", false);
    expect(nova.map((t) => t.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("pontas não se movem", () => {
    expect(moverTemplate(lista, "a", "subir", false)).toBe(lista);
    expect(moverTemplate(lista, "d", "descer", false)).toBe(lista);
  });
});

describe("segurança", () => {
  it("id desconhecido não mexe em nada", () => {
    expect(moverTemplate(lista, "zzz", "subir", true)).toBe(lista);
  });

  it("não muta a lista original", () => {
    const antes = lista.map((t) => t.id);
    moverTemplate(lista, "c", "subir", true);
    expect(lista.map((t) => t.id)).toEqual(antes);
  });
});
