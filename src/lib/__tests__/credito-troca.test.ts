// Guarda RN-074
import { describe, it, expect } from "vitest";
import { computeOrderTotals } from "../orders";
import { STATUS_QUE_USAM_CREDITO, creditoAUsar, recusaDoCredito, saldoDeCredito } from "../troca/regra";
import { CATEGORIAS_PADRAO } from "../financeiro/cadastros";

/**
 * RN-074 · O CRÉDITO DA TROCA VIRA DESCONTO NO PEDIDO NOVO, E A DIFERENÇA
 * QUE ANDOU EM DINHEIRO ENTRA NO FINANCEIRO.
 */

const itens = [{ quantity: 2, unitPrice: 50 }];

describe("RN-074 · o crédito na conta do pedido", () => {
  it("é desconto: sai DEPOIS do desconto e do acréscimo e reduz o valor vendido (não é pagamento)", () => {
    const t = computeOrderTotals(itens, 10, 15, 0, 12);
    expect(t).toMatchObject({ subtotal: 100, discount: 10, netTotal: 78, total: 93, credito: 12 });
  });
  it("o frete NÃO é coberto por crédito (não é venda, RN-002)", () => {
    const t = computeOrderTotals(itens, 0, 30, 0, 500);
    expect(t.credito).toBe(100);
    expect(t.netTotal).toBe(0);
    expect(t.total).toBe(30);
  });
  it("nunca deixa o pedido negativo nem aceita crédito negativo; sem crédito, nada muda", () => {
    expect(computeOrderTotals(itens, 100, 0, 0, 50)).toMatchObject({ netTotal: 0, credito: 0 });
    expect(computeOrderTotals(itens, 0, 0, 0, -5)).toMatchObject({ netTotal: 100, credito: 0 });
    expect(computeOrderTotals(itens, 0, 0, 0)).toMatchObject({ netTotal: 100, total: 100, credito: 0 });
  });
  it("centavos fecham", () => {
    const t = computeOrderTotals([{ quantity: 3, unitPrice: 0.1 }], 0, 0, 0, 0.2);
    expect(t.netTotal).toBe(0.1);
  });
});

describe("RN-074 · quanto do crédito entra", () => {
  it("tudo o que a cliente tem, até o valor do pedido antes do crédito", () => {
    expect(creditoAUsar(12, 100, 0)).toBe(12);
    expect(creditoAUsar(150, 100, 0)).toBe(100);
    // já abateu 30: só cabe mais 70
    expect(creditoAUsar(150, 100, 30)).toBe(70);
    expect(creditoAUsar(0, 100, 0)).toBe(0);
    expect(creditoAUsar(-5, 100, 0)).toBe(0);
    expect(creditoAUsar(10, 100, 100)).toBe(0);
  });
  it("o saldo é a soma do livro (uso negativo, estorno positivo)", () => {
    expect(saldoDeCredito([{ valor: 12 }, { valor: -12 }, { valor: 12 }])).toBe(12);
  });
});

describe("RN-074 · em quais pedidos se usa crédito", () => {
  const base = { source: "CATALOGO", nuvemshopId: null };
  it("só os que ainda NÃO foram pagos nem entregues (orçamento, aguardando)", () => {
    expect([...STATUS_QUE_USAM_CREDITO]).toEqual(["ORCAMENTO", "AGUARDANDO_PAGAMENTO"]);
    for (const s of STATUS_QUE_USAM_CREDITO) expect(recusaDoCredito({ ...base, status: s })).toBeNull();
    expect(recusaDoCredito({ ...base, status: "PAGO" })).toContain("ainda não foi pago");
    expect(recusaDoCredito({ ...base, status: "ENTREGUE" })).toContain("ainda não foi pago");
    // a venda a prazo ENTREGUE já contou comissão na entrega (RN-069): abater
    // depois mexeria num mês fechado
    expect(recusaDoCredito({ ...base, status: "ENTREGUE_A_RECEBER" })).toContain("nem entregue");
    expect(recusaDoCredito({ ...base, status: "CANCELADO" })).toContain("cancelado");
  });
  it("nunca na venda da loja online (o valor é o da Nuvemshop)", () => {
    expect(recusaDoCredito({ status: "ORCAMENTO", source: "NUVEMSHOP", nuvemshopId: null })).toContain("loja online");
    expect(recusaDoCredito({ status: "ORCAMENTO", source: "CATALOGO", nuvemshopId: "123" })).toContain("loja online");
  });
});

describe("RN-074 · a devolução em dinheiro tem categoria própria no financeiro", () => {
  it("04.06 Devoluções e trocas é DESPESA, debaixo de Despesas com Vendas", () => {
    const c = CATEGORIAS_PADRAO.find((x) => x.codigo === "04.06");
    expect(c).toMatchObject({ nome: "Devoluções e trocas", tipo: "DESPESA" });
  });
});
