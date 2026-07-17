import { describe, expect, it } from "vitest";
import { parseCategoryOrder, sortCategories } from "../categories";

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
