import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { corIgual, fotoDaCor, ordenarFotosDaCor } from "../capa-por-cor";
import { coresPorFotoNs } from "../nuvemshop";

/**
 * CAPA POR COR — pedido da Entre Linhas (03/08/2026): produto com variações
 * de cor mostrava a foto da peça PRETA no card de toda cor. Agora cada foto
 * pode ser etiquetada com a cor que mostra — à mão no editor ou sozinha pela
 * Nuvemshop (variant.image_id) — e o card de cada cor usa a foto dela.
 */

const FOTOS = [
  { url: "capa.jpg", color: null },
  { url: "avela.jpg", color: "Avelã" },
  { url: "azul.jpg", color: "Azul Serenity" },
  { url: "preta.jpg", color: "Preto" },
];

describe("a foto do card de cada cor", () => {
  it("cor etiquetada usa a foto DELA", () => {
    expect(fotoDaCor(FOTOS, "Avelã")).toBe("avela.jpg");
    expect(fotoDaCor(FOTOS, "Azul Serenity")).toBe("azul.jpg");
  });

  it("acento e caixa não atrapalham (avela == Avelã)", () => {
    expect(fotoDaCor(FOTOS, "avela")).toBe("avela.jpg");
    expect(corIgual("AVELÃ", "avelã")).toBe(true);
  });

  it("cor sem foto etiquetada cai na CAPA GERAL (nada quebra)", () => {
    expect(fotoDaCor(FOTOS, "Verde Militar")).toBe("capa.jpg");
  });

  it("o casamento é EXATO: etiqueta 'Azul' não serve para 'Azul Serenity'", () => {
    // com "Azul Marinho" na grade, o "contém" colocaria a foto errada
    const fotos = [{ url: "capa.jpg", color: null }, { url: "a.jpg", color: "Azul" }];
    expect(fotoDaCor(fotos, "Azul Serenity")).toBe("capa.jpg");
  });

  it("produto sem etiqueta nenhuma segue exatamente como era", () => {
    const soCapa = [{ url: "1.jpg", color: null }, { url: "2.jpg", color: null }];
    expect(fotoDaCor(soCapa, "Preto")).toBe("1.jpg");
  });
});

describe("o carrossel da ficha aberto numa cor", () => {
  it("fotos da cor primeiro, depois as sem etiqueta, depois as outras — nenhuma some", () => {
    expect(ordenarFotosDaCor(FOTOS, "Preto")).toEqual([
      "preta.jpg",
      "capa.jpg",
      "avela.jpg",
      "azul.jpg",
    ]);
  });

  it("sem etiquetas, a ordem original fica intacta", () => {
    const soCapa = [{ url: "1.jpg", color: null }, { url: "2.jpg", color: null }];
    expect(ordenarFotosDaCor(soCapa, "Preto")).toEqual(["1.jpg", "2.jpg"]);
  });
});

describe("a Nuvemshop etiqueta sozinha (variant.image_id)", () => {
  const p = {
    id: 1,
    name: "Legging básica",
    attributes: ["Cor", "Tamanho"],
    images: [
      { id: 10, src: "preta.jpg" },
      { id: 11, src: "avela.jpg" },
      { id: 12, src: "dupla.jpg" },
    ],
    variants: [
      { id: 100, image_id: 10, values: ["Preto", "P"] },
      { id: 101, image_id: 11, values: ["Avelã", "P"] },
      { id: 102, image_id: 11, values: ["Avelã", "M"] },
      // a mesma foto usada por DUAS cores é ambígua → fica sem etiqueta
      { id: 103, image_id: 12, values: ["Preto", "G"] },
      { id: 104, image_id: 12, values: ["Avelã", "G"] },
    ],
  };

  it("foto da variação vira etiqueta de cor", () => {
    const m = coresPorFotoNs(p as never);
    expect(m.get("preta.jpg")).toBe("Preto");
    expect(m.get("avela.jpg")).toBe("Avelã");
  });

  it("foto compartilhada por cores diferentes fica SEM etiqueta (capa geral > cor errada)", () => {
    expect(coresPorFotoNs(p as never).has("dupla.jpg")).toBe(false);
  });

  it("produto sem image_id não etiqueta nada (nada inventado)", () => {
    expect(coresPorFotoNs({ id: 1, name: "X", images: [{ id: 1, src: "a.jpg" }], variants: [{ id: 2, values: ["Preto", "P"] }] } as never).size).toBe(0);
  });
});

describe("o sistema está amarrado", () => {
  const ler = (p2: string) => readFileSync(join(process.cwd(), p2), "utf8");

  it("o card, a sacola e a ficha do catálogo usam a foto da cor", () => {
    const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(cat).toContain("fotoDaCor(card.product.images, card.color)");
    expect(cat).toContain("fotoDaCor(c.product.images, c.color)");
    expect(cat).toContain("ordenarFotosDaCor(sheet.product.images, sheet.color)");
  });

  it("a etiqueta manual nunca é apagada pelo sync (só preenche onde é null)", () => {
    const ns = ler("src/lib/nuvemshop.ts");
    expect(ns).toContain("color: null");
    expect(ns).toContain("etiquetarFotosPorCor");
  });

  it("a API só mexe na etiqueta quando ela veio no pedido (cliente antigo não apaga)", () => {
    expect(ler("src/app/api/products/[id]/route.ts")).toContain(
      "...(e.color !== undefined ? { color: e.color } : {})"
    );
  });

  it("o editor oferece as cores da própria grade", () => {
    const view = ler("src/app/(app)/produtos/products-view.tsx");
    expect(view).toContain("colors?: string[]");
    expect(view).toContain('c !== "Único"');
  });
});
