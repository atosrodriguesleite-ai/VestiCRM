import { describe, expect, it } from "vitest";
import { custoPorPeca } from "../producao";

/**
 * Regra do custo quando SOBRA PONTA no corte.
 *
 * Fluxo real da mesa: o lojista destina o rolo inteiro (ex.: 15 kg),
 * enfesta o que dá e guarda a ponta que não coube (ex.: 4 kg) pra um corte
 * menor depois. O tecido guardado CONTINUA no estoque — ele não pode pesar
 * no custo das peças que saíram deste corte.
 *
 * Estes testes travam a matemática: o custo por peça usa só o tecido que
 * virou peça (plannedKg encolhido ao usedKg), não o que foi reservado.
 */

const PRECO_KG = 40; // R$/kg

describe("custo por peça quando sobra ponta guardada", () => {
  const pecas = 100;

  it("cobra só o tecido cortado (11 kg), não o destinado (15 kg)", () => {
    const cortado = custoPorPeca({ fabricCost: 11 * PRECO_KG, pieces: pecas, extras: [] });
    expect(cortado!.tecidoPorPeca).toBe(4.4); // 440 ÷ 100
  });

  it("cobrar o destinado inflaria o custo — o erro que a correção evita", () => {
    const errado = custoPorPeca({ fabricCost: 15 * PRECO_KG, pieces: pecas, extras: [] });
    const certo = custoPorPeca({ fabricCost: 11 * PRECO_KG, pieces: pecas, extras: [] });
    expect(errado!.tecidoPorPeca).toBe(6); // 600 ÷ 100
    // 36% a mais de custo por peça — some direto na margem
    const inflacao = (errado!.tecidoPorPeca - certo!.tecidoPorPeca) / certo!.tecidoPorPeca;
    expect(Math.round(inflacao * 100)).toBe(36);
  });

  it("as aparas da mesa JÁ estão diluídas no custo (não se pesa retalho)", () => {
    // 11 kg entraram, 100 peças saíram: o que virou apara está dentro do 4,40
    const c = custoPorPeca({ fabricCost: 11 * PRECO_KG, pieces: pecas, extras: [] });
    expect(c!.tecidoPorPeca * pecas).toBeCloseTo(11 * PRECO_KG, 6);
  });

  it("extras por peça entram por cima do tecido", () => {
    const c = custoPorPeca({
      fabricCost: 11 * PRECO_KG,
      pieces: pecas,
      extras: [
        { name: "Facção", value: 3.5 },
        { name: "Aviamento", value: 0.8 },
      ],
    });
    expect(c!.extrasPorPeca).toBe(4.3);
    expect(c!.total).toBe(8.7); // 4,40 + 4,30
  });

  it("sem peças produzidas não existe custo por peça (evita divisão por zero)", () => {
    expect(custoPorPeca({ fabricCost: 440, pieces: 0, extras: [] })).toBeNull();
  });
});

describe("rateio da ponta entre rolos (enfesto multicolor)", () => {
  /** Espelha o rateio do servidor: proporcional, com o último fechando a conta. */
  function ratear(restante: number, rolos: number[]): number[] {
    const total = rolos.reduce((a, r) => a + r, 0);
    const out: number[] = [];
    let feito = 0;
    for (const [i, r] of rolos.entries()) {
      const fatia =
        i === rolos.length - 1
          ? Math.round((restante - feito) * 1000) / 1000
          : Math.round(restante * (r / total) * 1000) / 1000;
      out.push(fatia);
      feito += fatia;
    }
    return out;
  }

  it("devolve exatamente o que sobrou, sem criar nem sumir kg", () => {
    const fatias = ratear(4, [9, 6]);
    expect(fatias.reduce((a, f) => a + f, 0)).toBeCloseTo(4, 6);
  });

  it("cada rolo recebe na proporção do que trouxe", () => {
    const [a, b] = ratear(4, [9, 6]);
    expect(a).toBeCloseTo(2.4, 2); // 9/15 de 4
    expect(b).toBeCloseTo(1.6, 2); // 6/15 de 4
  });

  it("com um rolo só, a ponta inteira volta pra ele", () => {
    expect(ratear(4, [15])).toEqual([4]);
  });

  it("divisão que não fecha redondo não perde grama (o último acerta)", () => {
    const fatias = ratear(1, [1, 1, 1]);
    expect(fatias.reduce((a, f) => a + f, 0)).toBeCloseTo(1, 6);
  });
});
