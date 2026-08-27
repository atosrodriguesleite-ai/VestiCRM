import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chaveDeCategoria, parseCategoryOrder, sortCategories } from "../categories";

describe("parseCategoryOrder", () => {
  it("lê o JSON salvo", () => {
    expect(parseCategoryOrder('["Vestidos","Blusas"]')).toEqual([
      "Vestidos",
      "Blusas",
    ]);
  });
  it("vazio/nulo/inválido viram lista vazia", () => {
    expect(parseCategoryOrder("")).toEqual([]);
    expect(parseCategoryOrder(null)).toEqual([]);
    expect(parseCategoryOrder("{quebrado")).toEqual([]);
    expect(parseCategoryOrder('{"a":1}')).toEqual([]);
  });
});

describe("sortCategories", () => {
  it("segue a ordem salva pelo lojista", () => {
    expect(
      sortCategories(["Blusas", "Calças", "Vestidos"], ["Vestidos", "Blusas"])
    ).toEqual(["Vestidos", "Blusas", "Calças"]);
  });
  it("categorias novas (fora da lista) vão para o fim, na ordem natural", () => {
    expect(
      sortCategories(["Saias", "Blusas", "Fitness"], ["Blusas"])
    ).toEqual(["Blusas", "Saias", "Fitness"]);
  });
  it("sem ordem salva, mantém a ordem natural", () => {
    expect(sortCategories(["B", "A"], [])).toEqual(["B", "A"]);
  });
  it("ignora maiúsculas/minúsculas", () => {
    expect(sortCategories(["blusas", "VESTIDOS"], ["Vestidos", "Blusas"])).toEqual([
      "VESTIDOS",
      "blusas",
    ]);
  });
});

describe("categorias byte-diferentes que renderizam iguais são UMA (incidente 27/08/2026)", () => {
  it("chaveDeCategoria iguala ç decomposto, espaço no fim, espaço duplo e NBSP", () => {
    const variantes = [
      "Regata Alça",
      "Regata Alça".normalize("NFD"),
      "Regata Alça ",
      "Regata  Alça",
      "Regata Alça",
    ];
    expect(new Set(variantes.map(chaveDeCategoria)).size).toBe(1);
  });

  it("sortCategories casa a ordem salva mesmo com a variante decomposta", () => {
    const salva = ["Baby Look", "Regata Alça"];
    const daLoja = ["Regata Alça".normalize("NFD"), "Baby Look"];
    expect(sortCategories(daLoja, salva)).toEqual([
      "Baby Look",
      "Regata Alça".normalize("NFD"),
    ]);
  });

  it("o catálogo público agrupa as seções pela chave canônica", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
      "utf8"
    );
    expect(fonte).toContain("chaveDeCategoria(p.category)");
    expect(fonte).toContain("rotuloCanonico");
  });
});
