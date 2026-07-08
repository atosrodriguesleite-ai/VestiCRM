import { describe, it, expect } from "vitest";
import { mixHex, readableOn, hexToRgb } from "../color";

describe("tema do catálogo personalizável", () => {
  it("hexToRgb converte corretamente", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#4B3621")).toEqual([75, 54, 33]);
  });

  it("mixHex nos extremos devolve as próprias cores", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  it("mixHex no meio devolve o tom intermediário", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("readableOn escolhe texto legível (fundo claro → tinta escura)", () => {
    expect(readableOn("#ffffff")).toBe("#1a1523");
    expect(readableOn("#111111")).toBe("#ffffff");
    // paleta padrão: marrom escuro pede texto claro
    expect(readableOn("#4B3621")).toBe("#ffffff");
  });
});
