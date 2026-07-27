import { describe, it, expect } from "vitest";
import {
  computeOrderTotals,
  ajusteParaFecharPor,
  unitPriceFor,
  orderNumber,
  round2,
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

describe("acréscimo, porcentagem e o valor VENDIDO (sem frete)", () => {
  const carrinho = [{ quantity: 10, unitPrice: 100 }]; // subtotal 1000

  it("o frete NUNCA entra no valor vendido", () => {
    const t = computeOrderTotals(carrinho, 0, 250);
    expect(t.netTotal).toBe(1000); // é o que fatura e o que comissiona
    expect(t.total).toBe(1250); // é o que a cliente paga
  });

  it("desconto em porcentagem sai sobre o subtotal", () => {
    const t = computeOrderTotals(carrinho, { pct: 10 }, 0);
    expect(t.discount).toBe(100);
    expect(t.netTotal).toBe(900);
  });

  it("porcentagem se recalcula quando o carrinho muda", () => {
    const maior = computeOrderTotals([{ quantity: 20, unitPrice: 100 }], { pct: 10 });
    expect(maior.discount).toBe(200); // 10% de 2000, não os 100 de antes
  });

  it("valor em reais NÃO se mexe quando o carrinho muda", () => {
    const a = computeOrderTotals(carrinho, { valor: 150 });
    const b = computeOrderTotals([{ quantity: 20, unitPrice: 100 }], { valor: 150 });
    expect(a.discount).toBe(150);
    expect(b.discount).toBe(150);
  });

  it("acréscimo em reais e em porcentagem", () => {
    expect(computeOrderTotals(carrinho, 0, 0, { valor: 80 }).netTotal).toBe(1080);
    expect(computeOrderTotals(carrinho, 0, 0, { pct: 5 }).surcharge).toBe(50);
  });

  it("desconto e acréscimo juntos, com frete por fora", () => {
    const t = computeOrderTotals(carrinho, { pct: 10 }, 40, { valor: 60 });
    expect(t.discount).toBe(100);
    expect(t.surcharge).toBe(60);
    expect(t.netTotal).toBe(960); // 1000 - 100 + 60
    expect(t.total).toBe(1000); // + 40 de frete
  });

  it("desconto não derruba o pedido abaixo de zero", () => {
    const t = computeOrderTotals(carrinho, { valor: 99999 }, 30, { valor: 200 });
    expect(t.netTotal).toBe(0);
    expect(t.total).toBe(30); // sobra só o frete a pagar
  });

  it("porcentagem fora da faixa é contida em 0..100", () => {
    expect(computeOrderTotals(carrinho, { pct: -5 }).discount).toBe(0);
    expect(computeOrderTotals(carrinho, { pct: 300 }).discount).toBe(1000);
  });

  it("acréscimo negativo é ignorado (não vira desconto por acidente)", () => {
    expect(computeOrderTotals(carrinho, 0, 0, { valor: -70 }).surcharge).toBe(0);
  });

  it("chamada antiga (número puro) continua funcionando", () => {
    const t = computeOrderTotals(carrinho, 200, 50);
    expect(t.discount).toBe(200);
    expect(t.surcharge).toBe(0);
    expect(t.netTotal).toBe(800);
    expect(t.total).toBe(850);
  });
});

describe("atalho 'fechar por' um valor redondo", () => {
  it("valor menor vira desconto", () => {
    expect(ajusteParaFecharPor(1000, 900)).toEqual({ discount: 100, surcharge: 0 });
  });

  it("valor maior vira acréscimo", () => {
    expect(ajusteParaFecharPor(1000, 1120)).toEqual({ discount: 0, surcharge: 120 });
  });

  it("o total digitado inclui o frete — ele sai da conta antes", () => {
    // "fecha por 1.050" num pedido de 1.000 + 50 de frete = nem desconto nem acréscimo
    expect(ajusteParaFecharPor(1000, 1050, 50)).toEqual({ discount: 0, surcharge: 0 });
    // "fecha por 1.000" com 50 de frete = 50 de desconto na mercadoria
    expect(ajusteParaFecharPor(1000, 1000, 50)).toEqual({ discount: 50, surcharge: 0 });
  });

  it("fechar em zero desconta no máximo o subtotal", () => {
    expect(ajusteParaFecharPor(1000, 0)).toEqual({ discount: 1000, surcharge: 0 });
  });

  it("valor negativo digitado não quebra a conta", () => {
    expect(ajusteParaFecharPor(1000, -500)).toEqual({ discount: 1000, surcharge: 0 });
  });
});
