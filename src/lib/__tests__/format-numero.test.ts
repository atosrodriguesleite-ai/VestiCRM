import { describe, expect, it } from "vitest";
import { numeroBR } from "../format";

/**
 * Leitura de valor em reais digitado à brasileira, nos campos de desconto,
 * acréscimo e frete das telas de pedido. O caso que motivou o helper:
 * "1.000" digitado no campo virava R$ 1,00 (parseFloat para no ponto).
 */
describe("numeroBR: dinheiro digitado à brasileira", () => {
  it("lê vírgula como separador decimal", () => {
    expect(numeroBR("35,9")).toBe(35.9);
    expect(numeroBR("0,5")).toBe(0.5);
  });

  it("ponto seguido de 3 dígitos é MILHAR, não decimal", () => {
    expect(numeroBR("1.000")).toBe(1000);
    expect(numeroBR("1.000,50")).toBe(1000.5);
    expect(numeroBR("1.234.567")).toBe(1234567);
  });

  it("aceita o jeito 'de programador' também", () => {
    expect(numeroBR("35.9")).toBe(35.9);
    expect(numeroBR("100")).toBe(100);
  });

  it("negativo, vazio e lixo viram 0 (os campos são não-negativos)", () => {
    expect(numeroBR("-5")).toBe(0);
    expect(numeroBR("")).toBe(0);
    expect(numeroBR("abc")).toBe(0);
    expect(numeroBR("R$ 25")).toBe(25);
  });
});
