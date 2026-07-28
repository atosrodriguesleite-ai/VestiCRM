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

  it("pedido ainda sem vendedor pode ser assumido", () => {
    expect(podeTransferirVenda(lara, { sellerId: null })).toBe(true);
  });

  it("gerente e dona transferem qualquer pedido", () => {
    expect(podeTransferirVenda(gerente, { sellerId: "lara" })).toBe(true);
    expect(podeTransferirVenda(dona, { sellerId: "juliana" })).toBe(true);
  });

  it("suporte não mexe em comissão", () => {
    expect(podeTransferirVenda(suporte, { sellerId: null })).toBe(false);
    expect(podeTransferirVenda(suporte, { sellerId: "lara" })).toBe(false);
  });
});
