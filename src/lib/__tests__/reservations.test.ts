import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reservarEstoque, reservarOQueTiver, textoDaFalta } from "../reservations";

/**
 * A REGRA: montou pedido, a peça sai do estoque na hora. Vale para o pedido
 * que a vendedora monta E para o pedido que a cliente monta no catálogo —
 * era esse segundo caminho que não segurava nada, e a peça sumia entre o
 * orçamento e o pagamento.
 */

/** Banco de mentira que imita o comportamento condicional do Postgres. */
function bancoFake(estoque: Record<string, number>) {
  return {
    productVariant: {
      async updateMany({
        where,
        data,
      }: {
        where: { id: string; stock: { gte: number } };
        data: { stock: { decrement: number } };
      }) {
        const atual = estoque[where.id] ?? 0;
        if (atual < where.stock.gte) return { count: 0 };
        estoque[where.id] = atual - data.stock.decrement;
        return { count: 1 };
      },
      async findUnique({ where }: { where: { id: string } }) {
        return { stock: estoque[where.id] ?? 0 };
      },
    },
  };
}

describe("reserva do pedido da vendedora (tudo ou nada)", () => {
  it("segura a peça no estoque", async () => {
    const estoque = { v1: 10 };
    const faltas = await reservarEstoque(bancoFake(estoque), [
      { variantId: "v1", quantity: 3, label: "Vestido (Rosa M)" },
    ]);
    expect(faltas).toEqual([]);
    expect(estoque.v1).toBe(7);
  });

  it("recusa quando não tem o suficiente — e não mexe no estoque", async () => {
    const estoque = { v1: 2 };
    const faltas = await reservarEstoque(bancoFake(estoque), [
      { variantId: "v1", quantity: 5, label: "Vestido (Rosa M)" },
    ]);
    expect(faltas).toEqual([{ label: "Vestido (Rosa M)", pedido: 5, disponivel: 2 }]);
    expect(estoque.v1).toBe(2); // intacto: quem chama decide o que fazer
  });

  it("duas vendas simultâneas da última peça: só uma passa", async () => {
    // é o caso que a conferência-e-depois-baixa deixava passar
    const estoque = { v1: 1 };
    const db = bancoFake(estoque);
    const item = [{ variantId: "v1", quantity: 1, label: "Última peça" }];
    const [a, b] = await Promise.all([reservarEstoque(db, item), reservarEstoque(db, item)]);
    const ganhou = [a, b].filter((r) => r.length === 0).length;
    expect(ganhou).toBe(1);
    expect(estoque.v1).toBe(0); // nunca negativo
  });

  it("item sem variação ou quantidade zero é ignorado", async () => {
    const estoque = { v1: 5 };
    const faltas = await reservarEstoque(bancoFake(estoque), [
      { variantId: null, quantity: 3, label: "avulso" },
      { variantId: "v1", quantity: 0, label: "zero" },
    ]);
    expect(faltas).toEqual([]);
    expect(estoque.v1).toBe(5);
  });
});

describe("reserva do pedido do catálogo (segura o que tiver)", () => {
  it("com estoque cheio, segura tudo", async () => {
    const estoque = { v1: 8 };
    const faltas = await reservarOQueTiver(bancoFake(estoque), [
      { variantId: "v1", quantity: 8, label: "Blusa (Off-white P)" },
    ]);
    expect(faltas).toEqual([]);
    expect(estoque.v1).toBe(0);
  });

  it("faltando peça, segura o que existe e RELATA a falta", async () => {
    const estoque = { v1: 2 };
    const faltas = await reservarOQueTiver(bancoFake(estoque), [
      { variantId: "v1", quantity: 5, label: "Blusa (Off-white P)" },
    ]);
    expect(estoque.v1).toBe(0); // segurou as 2 que havia
    expect(faltas).toEqual([{ label: "Blusa (Off-white P)", pedido: 5, disponivel: 2 }]);
  });

  it("peça esgotada não deixa o estoque negativo", async () => {
    const estoque = { v1: 0 };
    const faltas = await reservarOQueTiver(bancoFake(estoque), [
      { variantId: "v1", quantity: 3, label: "Saia (Preto Único)" },
    ]);
    expect(estoque.v1).toBe(0);
    expect(faltas[0].disponivel).toBe(0);
  });
});

describe("texto da falta (é o que a loja lê)", () => {
  it("diz quanto pediu e quanto restou", () => {
    expect(textoDaFalta([{ label: "Vestido (Rosa M)", pedido: 5, disponivel: 2 }])).toBe(
      "Vestido (Rosa M): você pediu 5 e restam 2"
    );
  });
  it("esgotado é esgotado", () => {
    expect(textoDaFalta([{ label: "Saia (Preto Único)", pedido: 1, disponivel: 0 }])).toBe(
      "Saia (Preto Único): esgotado"
    );
  });
});

describe("todo caminho que cria pedido segura o estoque", () => {
  const raiz = join(process.cwd(), "src/app/api");
  const catalogo = readFileSync(join(raiz, "catalog/order/route.ts"), "utf8");
  const vendedora = readFileSync(join(raiz, "orders/route.ts"), "utf8");

  it("pedido do CATÁLOGO reserva e marca o pedido como segurando estoque", () => {
    // o defeito relatado: orçamento de ontem, peça vendida hoje para outra
    expect(catalogo).toContain("reservarOQueTiver");
    expect(catalogo).toContain("stockDeducted: true");
    expect(catalogo).toMatch(/type: "SAIDA"/);
  });

  it("pedido da VENDEDORA reserva de forma atômica", () => {
    expect(vendedora).toContain("reservarEstoque");
  });
});
