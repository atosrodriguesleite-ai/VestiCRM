import { describe, it, expect } from "vitest";
import { pesoDoPedidoKg } from "../melhorenvio";

// Padrões de embalagem da loja usados nos cenários
const conn = {
  defaultWeightGrams: 300,
  categoryWeights: JSON.stringify({ Vestidos: 350, Calças: 600 }),
  boxWidthCm: 30,
  boxHeightCm: 15,
  boxLengthCm: 40,
};

describe("pesoDoPedidoKg (módulo Envios)", () => {
  it("usa o peso do produto quando cadastrado", () => {
    const kg = pesoDoPedidoKg(
      [{ quantity: 10, product: { weightGrams: 250, category: "Blusas" } }],
      conn
    );
    expect(kg).toBe(2.5);
  });

  it("cai para o padrão da categoria e depois para o padrão da loja", () => {
    const kg = pesoDoPedidoKg(
      [
        // sem peso próprio, categoria com padrão (350 g)
        { quantity: 2, product: { weightGrams: null, category: "Vestidos" } },
        // sem peso próprio, categoria sem padrão → padrão da loja (300 g)
        { quantity: 1, product: { weightGrams: 0, category: "Acessórios" } },
        // produto apagado (snapshot) → padrão da loja
        { quantity: 1, product: null },
      ],
      conn
    );
    expect(kg).toBe(1.3); // 700 + 300 + 300 = 1300 g
  });

  it("nunca devolve zero e ignora JSON de categorias quebrado", () => {
    const kg = pesoDoPedidoKg([], conn);
    expect(kg).toBe(0.05);
    const kg2 = pesoDoPedidoKg(
      [{ quantity: 1, product: { weightGrams: null, category: "Vestidos" } }],
      { ...conn, categoryWeights: "{quebrado" }
    );
    expect(kg2).toBe(0.3); // caiu no padrão da loja sem explodir
  });
});
