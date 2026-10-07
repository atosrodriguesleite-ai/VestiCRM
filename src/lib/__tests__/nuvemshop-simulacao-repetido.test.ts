import { describe, it, expect, vi } from "vitest";

/**
 * A PRÉVIA ANTES DE CONECTAR SEGUE A RN-072: a planilha com o SKU repetido
 * na grade (a Regata Quadrada com P, M, G e GG em "RQD-MAR-P") não pode
 * prometer "casaria" para o que a sincronização vai devolver como pendência.
 */

const locais = [
  {
    id: "quadrada",
    name: "Regata Quadrada",
    variants: ["P", "M"].map((t) => ({ id: `q-${t}`, color: "Azul Marinho", size: t, sku: `RQD-MAR-${t}` })),
  },
];
vi.mock("@/lib/db", () => ({ db: { product: { findMany: async () => locais } } }));

import { simularVinculo } from "../nuvemshop-simulacao";

const grade = (skus: string[]) => ({
  name: "Regata Quadrada",
  variants: ["P", "M", "G"].map((t, i) => ({ color: "Azul Marinho", size: t, sku: skus[i], stock: 1 })),
});

describe("simulação com SKU repetido lá (RN-072)", () => {
  it("só SKU repetido: nada casa, tudo vira pendência 'repetido LÁ'", async () => {
    const r = await simularVinculo("loja", [grade(["RQD-MAR-P", "RQD-MAR-P", "RQD-MAR-P"])]);
    expect(r.casariam).toBe(0);
    expect(r.pendencias.map((p) => [p.tamanho, p.repetidoLa])).toEqual([
      ["P", true],
      ["M", true],
      ["G", true],
    ]);
  });

  it("produto identificado por outro SKU: o repetido casa pela cor × tamanho que existe aqui", async () => {
    // P tem SKU único; M e G repetem "X" — M existe aqui, G não
    const r = await simularVinculo("loja", [grade(["RQD-MAR-P", "X", "X"])]);
    expect(r.casariam).toBe(2);
    expect(r.pendencias.map((p) => [p.tamanho, p.repetidoLa])).toEqual([["G", true]]);
  });
});
