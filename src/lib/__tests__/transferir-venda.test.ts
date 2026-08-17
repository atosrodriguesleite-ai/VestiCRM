import { describe, it, expect } from "vitest";
import { podeTransferirVenda } from "../orders";

/**
 * Transferir a venda mexe em COMISSÃO. A regra da loja é curta:
 * a vendedora transfere o que é dela; gerente e admin transferem qualquer um;
 * ninguém mexe no pedido de outra vendedora.
 */
const lara = { id: "lara", role: "SELLER" };
const juliana = { id: "juliana", role: "SELLER" };
const gerente = { id: "g", role: "MANAGER" };
const dona = { id: "d", role: "ADMIN" };
const suporte = { id: "s", role: "SUPPORT" };

describe("podeTransferirVenda", () => {
  it("vendedora transfere o pedido DELA", () => {
    expect(podeTransferirVenda(lara, { sellerId: "lara" })).toBe(true);
  });

  it("vendedora NÃO mexe no pedido da colega", () => {
    expect(podeTransferirVenda(lara, { sellerId: "juliana" })).toBe(false);
    expect(podeTransferirVenda(juliana, { sellerId: "lara" })).toBe(false);
  });

  it("pedido sem dona é DA LOJA: vendedora NÃO assume sozinha (gerência define)", () => {
    // A permissão antiga era letra morta (o escopo escondia esses pedidos),
    // mas a chavinha pedidosVisaoTotal os tornou visíveis — e visível +
    // assumível seria a comissão da loja indo embora em dois cliques
    // (RN-005 "não existe desvio" + RN-006; revisão 17/08/2026).
    expect(podeTransferirVenda(lara, { sellerId: null })).toBe(false);
  });

  it("gerente e dona transferem qualquer pedido (inclusive sem dona)", () => {
    expect(podeTransferirVenda(gerente, { sellerId: "lara" })).toBe(true);
    expect(podeTransferirVenda(gerente, { sellerId: null })).toBe(true);
    expect(podeTransferirVenda(dona, { sellerId: "juliana" })).toBe(true);
  });

  it("suporte não mexe em comissão", () => {
    expect(podeTransferirVenda(suporte, { sellerId: null })).toBe(false);
    expect(podeTransferirVenda(suporte, { sellerId: "lara" })).toBe(false);
  });
});
