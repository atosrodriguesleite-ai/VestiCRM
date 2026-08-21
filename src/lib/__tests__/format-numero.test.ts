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

import { mascaraTelefoneBR } from "../format";

/**
 * Guarda do incidente Toque Leve (agosto/2026): duas clientes seguidas
 * mandaram o pedido com o último dígito do telefone errado. O campo do
 * catálogo era o único sem teclado numérico e sem máscara.
 */
describe("máscara do telefone no catálogo", () => {
  it("celular com 9º dígito", () => {
    expect(mascaraTelefoneBR("75991289575")).toBe("(75) 99128-9575");
  });

  it("telefone de 10 dígitos", () => {
    expect(mascaraTelefoneBR("7591289574")).toBe("(75) 9128-9574");
  });

  it("vai formatando enquanto digita", () => {
    expect(mascaraTelefoneBR("7")).toBe("(7");
    expect(mascaraTelefoneBR("75")).toBe("(75");
    expect(mascaraTelefoneBR("759")).toBe("(75) 9");
    expect(mascaraTelefoneBR("759912")).toBe("(75) 9912");
    // no meio da digitação ainda não dá para saber se são 10 ou 11 dígitos:
    // a máscara assume o formato de 10 e se acerta quando o 11º chega
    expect(mascaraTelefoneBR("7599128")).toBe("(75) 9912-8");
    expect(mascaraTelefoneBR("75991289575")).toBe("(75) 99128-9575");
  });

  /**
   * Achado da revisão: cortar em 11 dígitos transformava um número VÁLIDO em
   * OUTRO número válido — "55 75 99128-9575" virava "(55) 75991-2895". Passava
   * na conferência e criava o cadastro fantasma que a entrega veio evitar.
   */
  it("com o DDI 55 junto, o 55 some do visor (número certo continua certo)", () => {
    expect(mascaraTelefoneBR("5575991289575")).toBe("(75) 99128-9575");
    expect(mascaraTelefoneBR("55 75 99128-9575")).toBe("(75) 99128-9575");
  });

  it("dígitos demais NÃO são cortados em silêncio — ficam à vista", () => {
    expect(mascaraTelefoneBR("759912895759999")).toBe("759912895759999");
  });

  it("número internacional passa cru — a máscara é brasileira", () => {
    expect(mascaraTelefoneBR("+351 912 345 678")).toBe("+351 912 345 678");
  });

  it("aguenta o que já vem formatado (colar do WhatsApp)", () => {
    expect(mascaraTelefoneBR("(75) 99128-9575")).toBe("(75) 99128-9575");
  });
});
