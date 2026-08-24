import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { montarRanking, chaveDoNome, valorVendidoDoItem } from "../tracking/insights";

/**
 * Ranking "Produtos — atenção × venda" da tela Inteligência.
 *
 * Dois defeitos reais (print do dono, 22/08/2026):
 *  1. "Regata Alça" aparecia DUAS vezes — nomes iguais aos olhos, diferentes
 *     no invisível (espaço no fim, acento composto de outro jeito, caixa);
 *  2. Conv. 100% em quase tudo — comparava PEÇAS na sacola com ABERTURAS da
 *     ficha, e no atacado uma adição é uma grade de 10+ peças.
 */

const produto = { id: "p1", name: "Regata Alça", category: "Regatas" };

describe("uma linha por produto (nada de xará invisível)", () => {
  it("espaço sobrando no nome congelado NÃO cria linha nova", () => {
    const linhas = montarRanking(
      [
        { type: "product_view", productId: "p1", productName: "Regata Alça" },
        // produto foi apagado do cadastro: sobra o nome da época, com espaço
        { type: "product_view", productId: "morto", productName: "Regata Alça " },
      ],
      [],
      [produto],
      "productName"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].views).toBe(2);
    expect(linhas[0].key).toBe("Regata Alça");
  });

  it("acento gravado de outro jeito (ç decomposto) também junta", () => {
    const decomposto = "Regata Alça"; // "ç" como c + cedilha combinante
    expect(chaveDoNome(decomposto)).toBe("Regata Alça");
    const linhas = montarRanking(
      [
        { type: "product_view", productId: null, productName: "Regata Alça" },
        { type: "product_view", productId: null, productName: decomposto },
      ],
      [],
      [],
      "productName"
    );
    expect(linhas).toHaveLength(1);
  });

  it("caixa diferente junta, e o nome exibido é o do cadastro", () => {
    const linhas = montarRanking(
      [{ type: "product_view", productId: "p1", productName: "Regata Alça" }],
      [{ productId: null, name: "REGATA ALÇA", quantity: 5, total: 160 }],
      [produto],
      "productName"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].key).toBe("Regata Alça");
    expect(linhas[0].sold).toBe(5);
  });

  it("nome congelado com espaço ainda ACHA o cadastro (venda não some da linha)", () => {
    const linhas = montarRanking(
      [{ type: "product_view", productId: "p1", productName: "Regata Alça" }],
      [{ productId: null, name: " Regata Alça ", quantity: 3, total: 96 }],
      [produto],
      "productName"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].sold).toBe(3);
  });

  it("produtos DIFERENTES de verdade continuam separados", () => {
    const linhas = montarRanking(
      [
        { type: "product_view", productId: "p1", productName: "Regata Alça" },
        { type: "product_view", productId: "p2", productName: "Regata de Alça" },
      ],
      [],
      [produto, { id: "p2", name: "Regata de Alça", category: "Regatas" }],
      "productName"
    );
    expect(linhas).toHaveLength(2);
  });
});

describe("conversão compara evento com evento (grade de atacado não estoura)", () => {
  it("3 aberturas, 1 adição de grade de 10 peças → 33%, não 100%", () => {
    const abertura = { type: "product_view", productId: "p1", productName: "Regata Alça" };
    const linhas = montarRanking(
      [
        abertura, abertura, abertura,
        { type: "cart_add", productId: "p1", productName: "Regata Alça", qty: 10 },
      ],
      [],
      [produto],
      "productName"
    );
    expect(linhas[0].adds).toBe(10); // +Sacola segue em PEÇAS (útil no atacado)
    expect(linhas[0].conversion).toBe(33.33);
  });

  it("teto de 100% continua (adição com a ficha aberta antes do recorte)", () => {
    const linhas = montarRanking(
      [{ type: "cart_add", productId: "p1", productName: "Regata Alça", qty: 12 }],
      [],
      [produto],
      "productName"
    );
    expect(linhas[0].conversion).toBe(100);
  });
});

describe("faturamento das linhas bate com o cartão (rateio do desconto global)", () => {
  // ADR-013: desconto/acréscimo são do PEDIDO; o item guarda preço × qtd.
  // Somar item.total fazia Produtos/Categorias mostrarem MAIS que a Visão
  // Geral (que soma netTotal, RN-002) — auditoria 24/08/2026.
  it("pedido de 1.000 com 10% de desconto: item de 100 vale 90", () => {
    expect(valorVendidoDoItem(100, 1000, 900)).toBe(90);
  });

  it("acréscimo também entra na fatia do item", () => {
    // subtotal 1.000 + acréscimo 100 → netTotal 1.100
    expect(valorVendidoDoItem(100, 1000, 1100)).toBeCloseTo(110, 10);
  });

  it("a soma das fatias devolve exatamente o netTotal do pedido", () => {
    const itens = [250, 330.5, 419.5]; // subtotal 1.000
    const soma = itens.reduce((a, t) => a + valorVendidoDoItem(t, 1000, 876.54), 0);
    expect(soma).toBeCloseTo(876.54, 8);
  });

  it("pedido sem subtotal (dado velho) não divide por zero: vale o total do item", () => {
    expect(valorVendidoDoItem(50, 0, 0)).toBe(50);
  });

  it("a consulta da Inteligência aplica o rateio de verdade", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src/lib/tracking/insights.ts"),
      "utf8"
    );
    expect(fonte).toContain("valorVendidoDoItem(item.total, item.order.subtotal, item.order.netTotal)");
  });
});
