import { describe, it, expect } from "vitest";
import {
  calcularEnfesto,
  calcularEnfestoRolos,
  preverPecas,
  custoPorPeca,
  resumoPesagem,
  custoPorModelo,
  custoPorCor,
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

describe("resumoPesagem (método da balança — aproveitamento por subtração)", () => {
  it("cenário do Atos: 15 kg cortados, 50 blusas de 200 g → 66,7% e 5 kg de lixo", () => {
    const r = resumoPesagem([{ name: "Blusa", pieces: 50, pieceWeightG: 200 }], 15)!;
    expect(r.pesoPecasKg).toBe(10);
    expect(r.utilizationPct).toBe(66.67);
    expect(r.wasteKg).toBe(5);
  });

  it("vários modelos no mesmo corte somam os pesos", () => {
    const r = resumoPesagem(
      [
        { name: "Blusa", pieces: 30, pieceWeightG: 200 }, // 6 kg
        { name: "Cropped", pieces: 20, pieceWeightG: 150 }, // 3 kg
      ],
      12
    )!;
    expect(r.pesoPecasKg).toBe(9);
    expect(r.utilizationPct).toBe(75);
    expect(r.wasteKg).toBe(3);
  });

  it("modelo sem peso unitário → não calcula (nada de número inventado)", () => {
    expect(
      resumoPesagem(
        [
          { name: "Blusa", pieces: 50, pieceWeightG: 200 },
          { name: "Cropped", pieces: 10 },
        ],
        15
      )
    ).toBeNull();
  });

  it("pesagem acima do cortado não gera desperdício negativo", () => {
    const r = resumoPesagem([{ name: "X", pieces: 100, pieceWeightG: 200 }], 15)!;
    expect(r.wasteKg).toBe(0);
  });
});

describe("calcularEnfestoRolos (corte multi-rolo)", () => {
  it("soma os metros de cada rolo pelo rendimento do próprio tecido", () => {
    const r = calcularEnfestoRolos(
      [
        { kg: 8, yieldMPerKg: 2.6 }, // 20,8 m
        { kg: 6, yieldMPerKg: 2.6 }, // 15,6 m
        { kg: 4, yieldMPerKg: 3.0 }, // 12 m (outro tecido)
      ],
      5
    );
    expect(r.lengthM).toBe(48.4);
    expect(r.sheets).toBe(9);
  });
});

describe("custoPorCor (a peça de cada cor paga o rolo da própria cor)", () => {
  it("Vinho mais caro por kg → peça Vinho carrega o custo de verdade", () => {
    const modelos = custoPorCor(
      [
        { color: "Terracota", kg: 8, pricePerKg: 100 }, // R$ 800
        { color: "Vinho", kg: 6, pricePerKg: 150 }, // R$ 900
      ],
      [
        { name: "Baby Look", color: "Terracota", size: "P", pieces: 32, pieceWeightG: 200 }, // 6,4 kg úteis
        { name: "Baby Look", color: "Vinho", size: "P", pieces: 24, pieceWeightG: 200 }, // 4,8 kg úteis
      ],
      0
    )!;
    // Terracota: 800/6,4 = 125/kg útil → 0,2 kg = R$ 25
    expect(modelos[0].tecidoPorPeca).toBe(25);
    // Vinho: 900/4,8 = 187,50/kg útil → 0,2 kg = R$ 37,50
    expect(modelos[1].tecidoPorPeca).toBe(37.5);
    // a soma fecha com o tecido total (1700)
    const soma = modelos.reduce((a, m) => a + m.tecidoPorPeca * m.pieces, 0);
    expect(Math.round(soma)).toBe(1700);
  });

  it("cor sem peso ou cor sem rolo → null (vale o rateio global)", () => {
    expect(
      custoPorCor(
        [{ color: "Preto", kg: 5, pricePerKg: 100 }],
        [{ name: "X", color: "Preto", size: "P", pieces: 10 }],
        0
      )
    ).toBeNull();
    expect(
      custoPorCor(
        [{ color: "Preto", kg: 5, pricePerKg: 100 }],
        [{ name: "X", color: "Rosa", size: "P", pieces: 10, pieceWeightG: 200 }],
        0
      )
    ).toBeNull();
  });

  it("acentos e caixa não atrapalham o casamento da cor", () => {
    const modelos = custoPorCor(
      [{ color: "PÊSSEGO", kg: 2, pricePerKg: 100 }],
      [{ name: "X", color: "pessego", size: "M", pieces: 10, pieceWeightG: 100 }],
      0
    )!;
    expect(modelos[0].tecidoPorPeca).toBe(20); // 200 ÷ 1 kg útil × 0,1
  });
});

describe("custoPorModelo (custo do kg útil)", () => {
  it("R$ 1.500 de tecido ÷ 10 kg úteis = R$ 150/kg → blusa de 200 g custa R$ 30", () => {
    const modelos = custoPorModelo(
      [{ name: "Blusa", pieces: 50, pieceWeightG: 200 }],
      1500,
      3.5
    )!;
    expect(modelos[0].tecidoPorPeca).toBe(30);
    expect(modelos[0].totalPorPeca).toBe(33.5);
  });

  it("cada modelo paga proporcional ao próprio peso", () => {
    const modelos = custoPorModelo(
      [
        { name: "Blusa", pieces: 30, pieceWeightG: 200 },
        { name: "Cropped", pieces: 20, pieceWeightG: 150 },
      ],
      900, // ÷ 9 kg úteis = R$ 100/kg útil
      0
    )!;
    expect(modelos[0].tecidoPorPeca).toBe(20); // 0,2 kg × 100
    expect(modelos[1].tecidoPorPeca).toBe(15); // 0,15 kg × 100
    // a soma fecha com o custo total do tecido
    const soma = modelos.reduce((a, m) => a + m.tecidoPorPeca * m.pieces, 0);
    expect(soma).toBe(900);
  });
});
