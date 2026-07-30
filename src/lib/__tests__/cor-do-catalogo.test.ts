import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeSwatch, chaveDeCor, COR_NEUTRA, CORES_PADRAO } from "../color";

/**
 * BOLINHA DE COR DO CATÁLOGO (incidente Toque Leve, 30/07/2026).
 *
 * A lojista cadastrou a cor "Café" em Configurações → Suas cores, com o marrom
 * dela. No catálogo a peça apareceu com a bolinha CINZA de "cor desconhecida":
 * a variação veio da Nuvemshop escrita "cafe" (sem acento, minúscula) e o
 * casamento era letra por letra. Acento, maiúscula e espaço sobrando não podem
 * separar a mesma cor — e a cor da LOJA sempre manda.
 */

const CAFE_DA_LOJA = "#6B4A2F";
const daLoja = [{ name: "Café", hex: CAFE_DA_LOJA }];

describe("a cor cadastrada pela loja manda", () => {
  it("“cafe” sem acento acha a cor “Café” cadastrada — era o bug", () => {
    expect(makeSwatch(daLoja)("cafe")).toBe(CAFE_DA_LOJA);
  });

  it.each(["Café", "CAFÉ", "café", "cafe", "  Cafe  ", "CAFE"])(
    "escrito como %s, acha a mesma cor",
    (escrito) => {
      expect(makeSwatch(daLoja)(escrito)).toBe(CAFE_DA_LOJA);
    }
  );

  it("a cor da loja vence a de fábrica (ela escolheu o tom dela)", () => {
    const meuPreto = "#000000";
    expect(makeSwatch([{ name: "Preto", hex: meuPreto }])("preto")).toBe(meuPreto);
    // sem cadastro, vale a de fábrica
    expect(makeSwatch([])("preto")).toBe(CORES_PADRAO.preto);
  });

  it("cor que ninguém conhece cai no neutro (nunca quebra a tela)", () => {
    expect(makeSwatch([])("Verde Musgo Especial")).toBe(COR_NEUTRA);
    expect(makeSwatch([])("")).toBe(COR_NEUTRA);
  });
});

describe("as cores de fábrica também casam sem acento", () => {
  it.each([
    ["Lilás", CORES_PADRAO.lilas],
    ["LILAS", CORES_PADRAO.lilas],
    ["Off-White", CORES_PADRAO["off-white"]],
    ["Terracota", CORES_PADRAO.terracota],
    ["Café", CORES_PADRAO.cafe],
  ])("%s", (escrito, esperado) => {
    expect(makeSwatch([])(escrito)).toBe(esperado);
  });

  it("café entrou na lista de fábrica (faltava, e é cor de moda comum)", () => {
    expect(CORES_PADRAO.cafe).toBeDefined();
  });

  it("toda chave de fábrica já está normalizada (senão nunca casaria)", () => {
    for (const k of Object.keys(CORES_PADRAO)) {
      expect(k).toBe(chaveDeCor(k));
    }
  });
});

describe("a regra vive num lugar só", () => {
  it("o catálogo não tem mais a própria tabela de cores", () => {
    const cat = readFileSync(
      join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
      "utf8"
    );
    expect(cat).toContain('import { makeSwatch, mixHex, readableOn } from "@/lib/color"');
    // a cópia antiga (com o hack "lilás"/"lilas" lado a lado) saiu de cena
    expect(cat).not.toContain("const COLOR_HEX");
    expect(cat).not.toContain('lilás: "#B49BD6", lilas:');
  });
});
