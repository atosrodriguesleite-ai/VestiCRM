import { describe, it, expect } from "vitest";
import {
  computeOrderTotals,
  unitPriceFor,
  orderNumber,
  round2,
  catalogPrice,
} from "../orders";

describe("computeOrderTotals", () => {
  it("soma itens, aplica desconto e frete", () => {
    const totals = computeOrderTotals(
      [
        { quantity: 2, unitPrice: 100 },
        { quantity: 1, unitPrice: 49.9 },
      ],
      20,
      15
    );
    expect(totals.subtotal).toBe(249.9);
    expect(totals.discount).toBe(20);
    expect(totals.shippingFee).toBe(15);
    expect(totals.total).toBe(244.9);
  });

  it("nunca gera total negativo: desconto é limitado ao subtotal", () => {
    const totals = computeOrderTotals([{ quantity: 1, unitPrice: 50 }], 500, 0);
    expect(totals.discount).toBe(50);
    expect(totals.total).toBe(0);
  });

  it("ignora desconto e frete negativos", () => {
    const totals = computeOrderTotals([{ quantity: 1, unitPrice: 80 }], -10, -5);
    expect(totals.discount).toBe(0);
    expect(totals.shippingFee).toBe(0);
    expect(totals.total).toBe(80);
  });

  it("arredonda para 2 casas (sem erro de ponto flutuante)", () => {
    const totals = computeOrderTotals([{ quantity: 3, unitPrice: 0.1 }]);
    expect(totals.subtotal).toBe(0.3);
    expect(totals.total).toBe(0.3);
  });

  it("carrinho vazio dá zero", () => {
    const totals = computeOrderTotals([]);
    expect(totals.total).toBe(0);
  });
});

describe("unitPriceFor", () => {
  const product = {
    retailPrice: 149.9,
    wholesalePrice: 89,
    minQuantity: 5,
  };

  it("varejo paga preço de varejo abaixo da quantidade mínima", () => {
    expect(unitPriceFor(product, 1, false)).toBe(149.9);
  });

  it("varejo ganha preço de atacado ao atingir a quantidade mínima", () => {
    expect(unitPriceFor(product, 5, false)).toBe(89);
  });

  it("cliente atacado sempre paga atacado", () => {
    expect(unitPriceFor(product, 1, true)).toBe(89);
  });

  it("produto sem preço de atacado sempre usa varejo", () => {
    const p = { retailPrice: 99.9, wholesalePrice: 0, minQuantity: 1 };
    expect(unitPriceFor(p, 10, true)).toBe(99.9);
  });
});

describe("orderNumber / round2", () => {
  it("formata número com 4 dígitos", () => {
    expect(orderNumber(7)).toBe("#0007");
    expect(orderNumber(1234)).toBe("#1234");
  });

  it("round2 arredonda corretamente", () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

/* ---------- preço exibido no catálogo público ---------- */

describe("catalogPrice", () => {
  const peca = { retailPrice: 49.9, wholesalePrice: 33 };

  it("padrão (VAREJO) mostra o preço de varejo", () => {
    expect(catalogPrice(peca, "VAREJO")).toBe(49.9);
    expect(catalogPrice(peca, null)).toBe(49.9);
    expect(catalogPrice(peca, undefined)).toBe(49.9);
  });

  it("ATACADO mostra o preço de atacado", () => {
    expect(catalogPrice(peca, "ATACADO")).toBe(33);
  });

  it("ATACADO sem preço de atacado cai pro varejo (nunca mostra zero)", () => {
    expect(catalogPrice({ retailPrice: 49.9, wholesalePrice: 0 }, "ATACADO")).toBe(49.9);
  });
});
