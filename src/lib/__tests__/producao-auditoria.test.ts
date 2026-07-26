import { describe, expect, it } from "vitest";
import {
  calcularEnfesto,
  calcularEnfestoRolos,
  custoPorCor,
  custoPorModelo,
  custoPorPeca,
  experienciasDe,
  preverPecas,
  resumoPesagem,
  roloDominante,
} from "../producao";
import { extrasTemFaccao } from "../producao-faccao";

/**
 * Auditoria do módulo Produção — trava as contas que sustentam os
 * indicadores do Dashboard e da tela de Cortes. Cada teste aqui existe
 * porque um erro nele viraria decisão errada de preço ou de compra.
 */

/* ---------------- enfesto: kg → metros → folhas ---------------- */

describe("aritmética do enfesto", () => {
  it("15 kg de tecido 2,6 m/kg dão 39 m", () => {
    const e = calcularEnfesto({ usedKg: 15, yieldMPerKg: 2.6, tableLengthM: 5 });
    expect(e.lengthM).toBe(39);
    expect(e.sheets).toBe(7); // 7 folhas completas de 5 m
    expect(e.leftoverM).toBe(4); // ponta de 4 m que não vira folha
  });

  it("sem mesa informada não inventa folhas", () => {
    const e = calcularEnfesto({ usedKg: 15, yieldMPerKg: 2.6, tableLengthM: null });
    expect(e.lengthM).toBe(39);
    expect(e.sheets).toBe(0);
    expect(e.leftoverM).toBe(0);
  });

  it("multi-rolo soma cada cor pelo rendimento do PRÓPRIO tecido", () => {
    const e = calcularEnfestoRolos(
      [
        { kg: 10, yieldMPerKg: 2.6 }, // 26 m
        { kg: 5, yieldMPerKg: 3.2 }, // 16 m
      ],
      6
    );
    expect(e.lengthM).toBe(42);
    expect(e.sheets).toBe(7);
  });

  it("kg negativo não vira metro (proteção de digitação)", () => {
    expect(calcularEnfesto({ usedKg: -5, yieldMPerKg: 2.6 }).lengthM).toBe(0);
  });
});

/* ---------------- método da balança ---------------- */

describe("aproveitamento por pesagem", () => {
  it("11 kg cortados e 50 blusas de 200 g = 90,9% de aproveitamento", () => {
    const r = resumoPesagem([{ name: "Blusa", pieces: 50, pieceWeightG: 200 }], 11);
    expect(r!.pesoPecasKg).toBe(10);
    expect(r!.utilizationPct).toBe(90.91);
    expect(r!.wasteKg).toBe(1);
  });

  it("só calcula com TODOS os pesos informados (não chuta meia conta)", () => {
    const r = resumoPesagem(
      [
        { name: "A", pieces: 10, pieceWeightG: 200 },
        { name: "B", pieces: 10, pieceWeightG: null },
      ],
      5
    );
    expect(r).toBeNull();
  });

  it("peças mais pesadas que o cortado não geram desperdício negativo", () => {
    const r = resumoPesagem([{ name: "A", pieces: 100, pieceWeightG: 200 }], 15);
    expect(r!.wasteKg).toBe(0);
  });
});

/* ---------------- custo por peça e por cor ---------------- */

describe("custo por peça", () => {
  it("tecido dividido pelas peças + extras por peça", () => {
    const c = custoPorPeca({
      fabricCost: 600,
      pieces: 100,
      extras: [{ name: "Aviamento", value: 1.2 }],
    });
    expect(c!.tecidoPorPeca).toBe(6);
    expect(c!.total).toBe(7.2);
  });

  it("extras negativos não viram desconto (blindagem de digitação)", () => {
    const c = custoPorPeca({
      fabricCost: 600,
      pieces: 100,
      extras: [{ name: "Erro", value: -50 }],
    });
    expect(c!.extrasPorPeca).toBe(0);
  });

  it("custo por COR: cada peça paga o rolo da própria cor", () => {
    const r = custoPorCor(
      [
        { color: "Preto", kg: 10, pricePerKg: 40 }, // R$ 400
        { color: "Vinho", kg: 10, pricePerKg: 60 }, // R$ 600 (mais caro)
      ],
      [
        { name: "Blusa", color: "Preto", pieces: 40, pieceWeightG: 200 }, // 8 kg úteis
        { name: "Blusa", color: "Vinho", pieces: 40, pieceWeightG: 200 }, // 8 kg úteis
      ],
      0
    );
    // R$ 400 ÷ 8 kg = R$ 50/kg útil → peça de 200 g custa R$ 10
    expect(r![0].tecidoPorPeca).toBe(10);
    // R$ 600 ÷ 8 kg = R$ 75/kg útil → peça de 200 g custa R$ 15
    expect(r![1].tecidoPorPeca).toBe(15);
  });

  it("cor da peça sem rolo correspondente devolve null (não força rateio errado)", () => {
    const r = custoPorCor(
      [{ color: "Preto", kg: 10, pricePerKg: 40 }],
      [{ name: "Blusa", color: "Azul", pieces: 10, pieceWeightG: 200 }],
      0
    );
    expect(r).toBeNull();
  });

  it("custo por modelo usa kg ÚTIL: o desperdício é pago pelas peças boas", () => {
    // R$ 1.500 de tecido, só 10 kg viraram peça → R$ 150 por kg útil
    const r = custoPorModelo(
      [{ name: "Blusa", pieces: 50, pieceWeightG: 200 }],
      1500,
      0
    );
    expect(r![0].tecidoPorPeca).toBe(30); // 0,2 kg × 150
  });
});

/* ---------------- previsão por similaridade ---------------- */

describe("motor de previsão", () => {
  const hist = [
    { piecesPerKg: 5, fabricId: "f1", productName: "Blusa", date: new Date() },
    { piecesPerKg: 5.2, fabricId: "f1", productName: "Blusa", date: new Date() },
  ];

  it("projeta pelo histórico parecido e informa em quantos cortes se baseou", () => {
    const p = preverPecas(hist, { fabricId: "f1", productName: "Blusa" }, 10);
    expect(p!.pecas).toBeGreaterThan(45);
    expect(p!.pecas).toBeLessThan(55);
    expect(p!.base).toBe(2);
    expect(p!.min).toBeLessThanOrEqual(p!.pecas);
    expect(p!.max).toBeGreaterThanOrEqual(p!.pecas);
  });

  it("ignora experiência sem NADA em comum", () => {
    const p = preverPecas(
      [{ piecesPerKg: 99, fabricId: "outro", productName: "Calça" }],
      { fabricId: "f1", productName: "Blusa" },
      10
    );
    expect(p).toBeNull();
  });

  it("a taxa do PRÓPRIO corte puxa a projeção (mesmo rolo, mesmo plano)", () => {
    const semPropria = preverPecas(hist, { fabricId: "f1", productName: "Blusa" }, 10)!;
    const comPropria = preverPecas(hist, { fabricId: "f1", productName: "Blusa" }, 10, 8)!;
    // a medição do próprio corte pesa mais que qualquer experiência isolada,
    // então puxa a taxa de ~5,1 pra perto de 6,3 — sem ignorar o histórico
    expect(comPropria.taxaKg).toBeGreaterThan(semPropria.taxaKg + 1);
    expect(comPropria.taxaKg).toBeLessThan(8);
    expect(comPropria.base).toBe(2); // e não conta a si mesma como "histórico"
  });

  it("com pouca base a margem é larga (honestidade > precisão falsa)", () => {
    const pouco = preverPecas(
      [{ piecesPerKg: 5, fabricId: "f1", productName: "Blusa" }],
      { fabricId: "f1", productName: "Blusa" },
      10
    )!;
    const faixaPouco = pouco.max - pouco.min;
    const muito = preverPecas(
      Array.from({ length: 25 }, () => ({
        piecesPerKg: 5,
        fabricId: "f1",
        productName: "Blusa",
        date: new Date(),
      })),
      { fabricId: "f1", productName: "Blusa" },
      10
    )!;
    expect(faixaPouco).toBeGreaterThan(muito.max - muito.min);
  });

  it("sem kg não há projeção", () => {
    expect(preverPecas(hist, { fabricId: "f1" }, 0)).toBeNull();
  });
});

/* ---------------- histórico e rolo dominante ---------------- */

describe("experiências do histórico", () => {
  const corte = (usedKg: number, piecesTotal: number | null) => ({
    usedKg,
    piecesTotal,
    finalizedAt: new Date(),
    productName: "Blusa",
    gradeInfo: null,
    tableName: null,
    operator: null,
    rolls: [
      {
        plannedKg: 10,
        roll: {
          color: "Preto",
          fabric: { id: "f1", type: "malha", supplier: "X", grammage: 260 },
        },
      },
    ],
  });

  it("taxa da experiência = peças ÷ kg realmente usados", () => {
    const [e] = experienciasDe([corte(10, 50)]);
    expect(e.piecesPerKg).toBe(5);
  });

  it("corte sem peças não vira experiência (não envenena o motor)", () => {
    expect(experienciasDe([corte(10, null), corte(10, 0)])).toHaveLength(0);
  });

  it("cor só entra quando o corte foi de uma cor só", () => {
    const multi = {
      ...corte(10, 50),
      rolls: [
        { plannedKg: 6, roll: { color: "Preto", fabric: { id: "f1", type: null, supplier: null, grammage: null } } },
        { plannedKg: 4, roll: { color: "Vinho", fabric: { id: "f1", type: null, supplier: null, grammage: null } } },
      ],
    };
    expect(experienciasDe([multi])[0].color).toBeNull();
    expect(experienciasDe([corte(10, 50)])[0].color).toBe("Preto");
  });

  it("rolo dominante é o de maior peso (define o contexto do corte)", () => {
    const dom = roloDominante([{ plannedKg: 4 }, { plannedKg: 9 }, { plannedKg: 2 }]);
    expect(dom!.plannedKg).toBe(9);
  });
});

/* ---------------- guarda contra facção contada duas vezes ---------------- */

describe("facção nos custos extras", () => {
  it("reconhece a costura lançada à mão em várias escritas", () => {
    for (const nome of ["Facção", "faccao", "Costura externa", "Oficina da Maria", "Terceirizado"])
      expect(extrasTemFaccao([{ name: nome }])).toBe(true);
  });

  it("não confunde com custos que nada têm a ver", () => {
    expect(extrasTemFaccao([{ name: "Aviamento" }, { name: "Etiqueta" }])).toBe(false);
  });

  it("lista vazia não bloqueia a média automática", () => {
    expect(extrasTemFaccao([])).toBe(false);
  });
});
