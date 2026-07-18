import { describe, it, expect } from "vitest";
import {
  calcularEnfesto,
  preverPecas,
  custoPorPeca,
  type Experiencia,
} from "../producao";

describe("calcularEnfesto (aritmética do corte)", () => {
  it("cenário do Atos: 13 kg × 2,60 m/kg = 33,80 m → 6 folhas na mesa de 5 m", () => {
    const r = calcularEnfesto({ usedKg: 13, yieldMPerKg: 2.6, tableLengthM: 5 });
    expect(r.lengthM).toBe(33.8);
    expect(r.sheets).toBe(6);
    expect(r.leftoverM).toBe(3.8);
  });

  it("sem mesa cadastrada calcula só os metros", () => {
    const r = calcularEnfesto({ usedKg: 10, yieldMPerKg: 2.5, tableLengthM: null });
    expect(r.lengthM).toBe(25);
    expect(r.sheets).toBe(0);
  });

  it("valores negativos não quebram a conta", () => {
    const r = calcularEnfesto({ usedKg: -5, yieldMPerKg: 2.6, tableLengthM: 5 });
    expect(r.lengthM).toBe(0);
  });
});

describe("preverPecas (motor de projeção)", () => {
  it("corte parcial usa a taxa do próprio corte: 61 peças em 13 kg → ~9 nos 2 kg restantes", () => {
    // sem histórico ainda: só a taxa própria (61/13 = 4,69 peças/kg)
    const p = preverPecas([], {}, 2, 61 / 13);
    expect(p).not.toBeNull();
    expect(p!.pecas).toBe(9); // 4,69 × 2 = 9,38 → 9
    expect(p!.min).toBeLessThanOrEqual(9);
    expect(p!.max).toBeGreaterThanOrEqual(9);
    expect(p!.base).toBe(0); // nenhum corte parecido — só o próprio
  });

  it("sem histórico e sem taxa própria não inventa número", () => {
    expect(preverPecas([], { productName: "Baby Look" }, 5)).toBeNull();
  });

  it("histórico parecido pesa mais que histórico diferente", () => {
    const historico: Experiencia[] = [
      // mesmo produto e tecido: rende 5 peças/kg
      { piecesPerKg: 5, fabricId: "f1", productName: "Baby Look", date: new Date() },
      { piecesPerKg: 5, fabricId: "f1", productName: "Baby Look", date: new Date() },
      // produto diferente de outro tecido: rende 2 peças/kg
      { piecesPerKg: 2, fabricId: "f2", productName: "Vestido Longo", date: new Date() },
    ];
    const p = preverPecas(historico, { fabricId: "f1", productName: "Baby Look" }, 10);
    // deve ficar perto de 50 (5/kg): o corte sem nada em comum é ignorado
    expect(p!.pecas).toBeGreaterThanOrEqual(48);
    expect(p!.base).toBe(2);
  });

  it("experiências sem NADA em comum são ignoradas", () => {
    const historico: Experiencia[] = [
      { piecesPerKg: 9, fabricId: "outro", productName: "Outra Peça" },
    ];
    expect(preverPecas(historico, { fabricId: "f1", productName: "Body" }, 4)).toBeNull();
  });

  it("a margem encurta quando o histórico cresce", () => {
    const ctx = { fabricId: "f1", productName: "Baby Look" };
    const poucos = preverPecas(
      [{ piecesPerKg: 5, fabricId: "f1", productName: "Baby Look", date: new Date() }],
      ctx,
      10
    )!;
    const muitos = preverPecas(
      Array.from({ length: 25 }, () => ({
        piecesPerKg: 5,
        fabricId: "f1",
        productName: "Baby Look",
        date: new Date(),
      })),
      ctx,
      10
    )!;
    expect(muitos.max - muitos.min).toBeLessThan(poucos.max - poucos.min);
  });

  it("cortes antigos pesam menos que recentes", () => {
    const antigo: Experiencia = {
      piecesPerKg: 10,
      fabricId: "f1",
      productName: "Baby Look",
      date: new Date(Date.now() - 720 * 86_400_000), // 2 anos atrás
    };
    const recente: Experiencia = {
      piecesPerKg: 4,
      fabricId: "f1",
      productName: "Baby Look",
      date: new Date(),
    };
    const p = preverPecas([antigo, recente], { fabricId: "f1", productName: "Baby Look" }, 10)!;
    expect(p.pecas).toBeLessThan(60); // puxado pro recente (40), não pra média (70)
  });
});

describe("custoPorPeca", () => {
  it("tecido + extras por peça", () => {
    // 15 kg a R$ 40/kg = R$ 600 → 69 peças = R$ 8,70 de tecido
    const c = custoPorPeca({
      fabricCost: 600,
      pieces: 69,
      extras: [
        { name: "Mão de obra", value: 3.5 },
        { name: "Etiqueta", value: 0.3 },
      ],
    })!;
    expect(c.tecidoPorPeca).toBe(8.7);
    expect(c.extrasPorPeca).toBe(3.8);
    expect(c.total).toBe(12.5);
  });

  it("sem peças produzidas não divide por zero", () => {
    expect(custoPorPeca({ fabricCost: 100, pieces: 0, extras: [] })).toBeNull();
  });
});
