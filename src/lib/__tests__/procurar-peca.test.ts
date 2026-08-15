import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { casaPeca, procurarPecas } from "../catalogo/procurar-peca";

/**
 * LUPA DA VITRINE.
 *
 * Caso real (Toque Leve, 07/08/2026): a peça ESTAVA no catálogo — o
 * conferidor provou, cor por cor — e a loja continuava dizendo "não
 * aparece". Com 178 produtos e um card por COR, ela simplesmente não achava:
 * o catálogo público não tinha busca nenhuma.
 */

const peca = (
  name: string,
  color: string,
  extra: { sku?: string; category?: string; tags?: string | null } = {}
) => ({
  product: {
    name,
    sku: extra.sku ?? "SKU-1",
    category: extra.category ?? "Bermudas",
    tags: extra.tags ?? null,
  },
  color,
});

const vitrine = [
  peca("Bermuda Bolso Premium", "Avelã", { sku: "359003402", tags: "lançamento, festa" }),
  peca("Bermuda Bolso Premium", "Preto", { sku: "359003402" }),
  peca("Blusa Ombro Único", "Preto", { sku: "771002", category: "Blusas" }),
  peca("Conjunto Alfaiataria", "Azul Serenity", { sku: "880011", category: "Conjuntos" }),
];

describe("procurar peça na vitrine", () => {
  it("acha pelo nome", () => {
    expect(procurarPecas(vitrine, "bermuda")).toHaveLength(2);
  });

  it("ACENTO não atrapalha — ninguém digita 'Avelã' com til no corre", () => {
    expect(procurarPecas(vitrine, "avela")).toHaveLength(1);
    expect(procurarPecas(vitrine, "AVELÃ")).toHaveLength(1);
  });

  it("acha pelo código da peça (é o que a vendedora tem na mão)", () => {
    expect(procurarPecas(vitrine, "359003")).toHaveLength(2);
  });

  it("acha pela cor", () => {
    expect(procurarPecas(vitrine, "preto")).toHaveLength(2);
  });

  it("acha pela categoria e pela etiqueta", () => {
    expect(procurarPecas(vitrine, "conjuntos")).toHaveLength(1);
    expect(procurarPecas(vitrine, "festa")).toHaveLength(1);
  });

  it("DUAS PALAVRAS afinam em vez de somar — 'bermuda preto' é uma peça só", () => {
    // o erro clássico seria devolver toda bermuda MAIS toda peça preta
    const r = procurarPecas(vitrine, "bermuda preto");
    expect(r).toHaveLength(1);
    expect(r[0].color).toBe("Preto");
  });

  it("a ordem das palavras não importa", () => {
    expect(procurarPecas(vitrine, "preto bermuda")).toHaveLength(1);
  });

  it("busca vazia não some com nada", () => {
    expect(procurarPecas(vitrine, "")).toHaveLength(4);
    expect(procurarPecas(vitrine, "   ")).toHaveLength(4);
  });

  it("nada encontrado devolve lista vazia (e a tela avisa)", () => {
    expect(procurarPecas(vitrine, "vestido de noiva")).toHaveLength(0);
  });

  it("peça sem etiqueta não quebra a busca", () => {
    expect(casaPeca(peca("Saia Midi", "Bege", { tags: null }), "saia")).toBe(true);
  });
});

describe("a vitrine usa a lupa e o link direto", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("tem campo de busca no catálogo público", () => {
    expect(/procurarPecas\(/.test(fonte)).toBe(true);
    expect(fonte).toContain("Procurar peça, cor ou código");
  });

  it("procurando, a vitrine vira uma lista só (sem adivinhar a seção)", () => {
    expect(/procurando/.test(fonte)).toBe(true);
    expect(/achados\.map\(desenharCard\)/.test(fonte)).toBe(true);
  });

  it("o card é UM desenho só — seções e busca usam o mesmo", () => {
    expect(/cards\.map\(desenharCard\)/.test(fonte)).toBe(true);
  });

  it("`?peca=` abre a vitrine já na peça (acaba o 'está lá' × 'não está')", () => {
    expect(/get\("peca"\)/.test(fonte)).toBe(true);
    const rota = readFileSync(
      join(process.cwd(), "src/app/api/products/[id]/catalogo/route.ts"),
      "utf8"
    );
    expect(/\?peca=\$\{produto\.id\}/.test(rota)).toBe(true);
  });
});
