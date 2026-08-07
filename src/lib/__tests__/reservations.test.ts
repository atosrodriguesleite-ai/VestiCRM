import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  juntarPorVariacao,
  reservarCom,
  reservarOQueTiver,
  textoDaFalta,
} from "../reservations";

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

/**
 * A baixa em lote, imitando o que o Postgres faz no comando único: cada
 * peça é conferida contra o próprio saldo e só sai se couber. É a mesma
 * regra que roda em produção — aqui sem banco, para poder testar.
 */
function baixaFake(estoque: Record<string, number>) {
  return async (pedidos: { variantId: string; quantity: number }[]) => {
    const ok: string[] = [];
    for (const p of pedidos) {
      const atual = estoque[p.variantId] ?? 0;
      if (atual >= p.quantity) {
        estoque[p.variantId] = atual - p.quantity;
        ok.push(p.variantId);
      }
    }
    return ok;
  };
}

const consultaFake = (estoque: Record<string, number>) => async (ids: string[]) =>
  new Map(ids.map((id) => [id, estoque[id] ?? 0]));

/** Mesma porta de sempre, agora pelo caminho novo (lote). */
const reservarEstoque = (
  db: ReturnType<typeof bancoFake>,
  itens: Parameters<typeof reservarCom>[2],
  estoque?: Record<string, number>
) => reservarCom(baixaFake(estoque!), consultaFake(estoque!), itens);

describe("reserva do pedido da vendedora (tudo ou nada)", () => {
  it("segura a peça no estoque", async () => {
    const estoque = { v1: 10 };
    const faltas = await reservarEstoque(bancoFake(estoque), [
      { variantId: "v1", quantity: 3, label: "Vestido (Rosa M)" },
    ], estoque);
    expect(faltas).toEqual([]);
    expect(estoque.v1).toBe(7);
  });

  it("recusa quando não tem o suficiente — e não mexe no estoque", async () => {
    const estoque = { v1: 2 };
    const faltas = await reservarEstoque(bancoFake(estoque), [
      { variantId: "v1", quantity: 5, label: "Vestido (Rosa M)" },
    ], estoque);
    expect(faltas).toEqual([{ label: "Vestido (Rosa M)", pedido: 5, disponivel: 2 }]);
    expect(estoque.v1).toBe(2); // intacto: quem chama decide o que fazer
  });

  it("duas vendas simultâneas da última peça: só uma passa", async () => {
    // é o caso que a conferência-e-depois-baixa deixava passar
    const estoque = { v1: 1 };
    const db = bancoFake(estoque);
    const item = [{ variantId: "v1", quantity: 1, label: "Última peça" }];
    const [a, b] = await Promise.all([
      reservarEstoque(db, item, estoque),
      reservarEstoque(db, item, estoque),
    ]);
    const ganhou = [a, b].filter((r) => r.length === 0).length;
    expect(ganhou).toBe(1);
    expect(estoque.v1).toBe(0); // nunca negativo
  });

  it("item sem variação ou quantidade zero é ignorado", async () => {
    const estoque = { v1: 5 };
    const faltas = await reservarEstoque(bancoFake(estoque), [
      { variantId: null, quantity: 3, label: "avulso" },
      { variantId: "v1", quantity: 0, label: "zero" },
    ], estoque);
    expect(faltas).toEqual([]);
    expect(estoque.v1).toBe(5);
  });
});

describe("reserva do pedido do catálogo (segura o que tiver)", () => {
  it("com estoque cheio, segura tudo", async () => {
    const estoque = { v1: 8 };
    const { faltas, seguradas } = await reservarOQueTiver(bancoFake(estoque), [
      { variantId: "v1", quantity: 8, label: "Blusa (Off-white P)" },
    ]);
    expect(faltas).toEqual([]);
    expect(seguradas).toEqual([{ variantId: "v1", quantity: 8 }]);
    expect(estoque.v1).toBe(0);
  });

  it("faltando peça, segura o que existe e RELATA a falta", async () => {
    const estoque = { v1: 2 };
    const { faltas, seguradas } = await reservarOQueTiver(bancoFake(estoque), [
      { variantId: "v1", quantity: 5, label: "Blusa (Off-white P)" },
    ]);
    expect(estoque.v1).toBe(0); // segurou as 2 que havia
    // o movimento gravado é o que FOI segurado (2), não o pedido (5)
    expect(seguradas).toEqual([{ variantId: "v1", quantity: 2 }]);
    expect(faltas).toEqual([{ label: "Blusa (Off-white P)", pedido: 5, disponivel: 2 }]);
  });

  it("peça esgotada não deixa o estoque negativo", async () => {
    const estoque = { v1: 0 };
    const { faltas, seguradas } = await reservarOQueTiver(bancoFake(estoque), [
      { variantId: "v1", quantity: 3, label: "Saia (Preto Único)" },
    ]);
    expect(estoque.v1).toBe(0);
    expect(seguradas).toEqual([]);
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

/**
 * A MESMA PEÇA EM DUAS LINHAS.
 *
 * Nasceu do pedido colado do WhatsApp: duas linhas da mensagem podem apontar
 * para a mesma variação. Conferindo linha por linha, cada uma via saldo
 * suficiente sozinha e o estoque ficava negativo. A conferência tem que ser
 * sobre o TOTAL.
 */
describe("mesma peça repetida no pedido", () => {
  it("as quantidades são somadas antes de conferir o estoque", () => {
    expect(
      juntarPorVariacao([
        { variantId: "v1", quantity: 1, label: "Blusa (Branco Único)" },
        { variantId: "v1", quantity: 2, label: "Blusa (Branco Único)" },
        { variantId: "v2", quantity: 1, label: "Saia (Preto P)" },
      ])
    ).toEqual([
      { variantId: "v1", quantity: 3, label: "Blusa (Branco Único)" },
      { variantId: "v2", quantity: 1, label: "Saia (Preto P)" },
    ]);
  });

  it("duas linhas de 1 peça com 1 em estoque NÃO passam", async () => {
    const estoque = { v1: 1 };
    const faltas = await reservarCom(
      baixaFake(estoque),
      consultaFake(estoque),
      [
        { variantId: "v1", quantity: 1, label: "Última peça" },
        { variantId: "v1", quantity: 1, label: "Última peça" },
      ]
    );
    expect(faltas).toEqual([{ label: "Última peça", pedido: 2, disponivel: 1 }]);
    expect(estoque.v1).toBe(1); // intacto — nada de negativo
  });

  it("linha sem variação e quantidade zero somem da conta", () => {
    expect(
      juntarPorVariacao([
        { variantId: null, quantity: 5, label: "avulso" },
        { variantId: "v1", quantity: 0, label: "zero" },
      ])
    ).toEqual([]);
  });
});

describe("pedido grande vai numa ida só ao banco", () => {
  it("29 linhas = UMA baixa, não 29", async () => {
    const estoque: Record<string, number> = {};
    const itens = Array.from({ length: 29 }, (_, i) => {
      estoque[`v${i}`] = 5;
      return { variantId: `v${i}`, quantity: 1, label: `Peça ${i}` };
    });
    let chamadas = 0;
    const baixar = baixaFake(estoque);
    const faltas = await reservarCom(
      async (p) => {
        chamadas++;
        return baixar(p);
      },
      consultaFake(estoque),
      itens
    );
    expect(faltas).toEqual([]);
    // era isto que estourava o tempo limite em produção
    expect(chamadas).toBe(1);
  });

  it("deu tudo certo? nem consulta o estoque de novo", async () => {
    const estoque = { v1: 9 };
    let consultas = 0;
    await reservarCom(
      baixaFake(estoque),
      async (ids) => {
        consultas++;
        return consultaFake(estoque)(ids);
      },
      [{ variantId: "v1", quantity: 2, label: "Blusa" }]
    );
    expect(consultas).toBe(0);
  });
});
