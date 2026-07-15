import { describe, it, expect } from "vitest";
import { compareSizes } from "../sizes";

const sort = (list: string[]) => [...list].sort(compareSizes);

describe("ordenação de tamanhos (menor → maior)", () => {
  it("ordena letras fora de ordem alfabética", () => {
    expect(sort(["G", "GG", "M", "P"])).toEqual(["P", "M", "G", "GG"]);
    expect(sort(["GG", "P", "PP", "XG", "M", "G"])).toEqual([
      "PP", "P", "M", "G", "GG", "XG",
    ].sort(compareSizes));
  });

  it("mantém PP antes de P e GG depois de G", () => {
    expect(sort(["P", "PP"])).toEqual(["PP", "P"]);
    expect(sort(["GG", "G"])).toEqual(["G", "GG"]);
  });

  it("ordena numéricos como número (não como texto)", () => {
    expect(sort(["40", "36", "38"])).toEqual(["36", "38", "40"]);
    expect(sort(["8", "10", "6"])).toEqual(["6", "8", "10"]);
  });

  it("letras vêm antes dos numéricos; único vai entre eles e desconhecidos", () => {
    expect(sort(["38", "M", "36", "G"])).toEqual(["M", "G", "36", "38"]);
    expect(sort(["Único", "P", "M"])).toEqual(["P", "M", "Único"]);
  });

  it("é indiferente a maiúsculas/minúsculas e espaços", () => {
    expect(sort(["gg", " p ", "m"])).toEqual([" p ", "m", "gg"]);
  });
});
