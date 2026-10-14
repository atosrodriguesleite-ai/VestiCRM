// Guarda RN-087
import { describe, it, expect, vi } from "vitest";
import { PAID_ORDER_STATUSES } from "../orders";

/**
 * RN-087 — a LINHA DE 12 MESES: contatos e vendas por mês direto das
 * tabelas de origem pela mesma régua dos fatos (cadastro no mês de SP;
 * pedido pago por paidAt, netTotal), e o atendimento só onde há fato
 * (`BiDia`), com nulo — nunca zero — no mês sem fato e a cobertura dita.
 */

const chamadas: { sql: string; params: unknown[] }[] = [];
vi.mock("../db", () => ({
  db: {
    $queryRaw: async (partes: TemplateStringsArray, ...params: unknown[]) => {
      const sql = partes.join("?");
      chamadas.push({ sql, params });
      if (sql.includes('FROM "Customer"')) return [{ mes: "2026-10", n: BigInt(3) }, { mes: "2026-09", n: BigInt(1) }];
      return [{ mes: "2026-10", n: BigInt(2), vendido: 270 }];
    },
    biDia: {
      async findMany() {
        return [
          { dia: "2026-10-12", respondidas: 2, noPrazo: 1, foraDoPrazo: 2, semResposta: 1 },
          { dia: "2026-10-13", respondidas: 0, noPrazo: 0, foraDoPrazo: 0, semResposta: 0 },
        ];
      },
    },
  },
}));

import { diasNoMes, juntarTendencia, mesesAte, montarTendencia, rotuloDoMes } from "../bi/tendencia";

describe("os meses", () => {
  it("os últimos 12 até o de agora, virando o ano, com rótulo curto", () => {
    const meses = mesesAte(new Date("2026-10-14T15:00:00.000Z"));
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe("2025-11");
    expect(meses[11]).toBe("2026-10");
    expect(rotuloDoMes("2026-10")).toBe("out/26");
    // 1º de janeiro às 01:00 UTC ainda é 31 de dezembro em SP
    expect(mesesAte(new Date("2027-01-01T01:00:00.000Z"))[11]).toBe("2026-12");
  });
  it("dias no mês: o mês de hoje conta até hoje; fevereiro bissexto tem 29", () => {
    expect(diasNoMes("2026-10", "2026-10-14")).toBe(14);
    expect(diasNoMes("2026-09", "2026-10-14")).toBe(30);
    expect(diasNoMes("2028-02", "2028-03-01")).toBe(29);
  });
});

describe("a junção", () => {
  it("contatos e vendas do banco; atendimento só onde há fato, nulo no mês sem fato", () => {
    const linhas = juntarTendencia(
      ["2026-09", "2026-10"],
      [{ mes: "2026-10", n: 3 }, { mes: "2026-09", n: 1 }],
      [{ mes: "2026-10", n: 2, vendido: 270.004 }],
      [{ dia: "2026-10-12", respondidas: 2, noPrazo: 1, foraDoPrazo: 2, semResposta: 1 }],
      "2026-10-14"
    );
    expect(linhas[0]).toMatchObject({ mes: "2026-09", leads: 1, pedidosPagos: 0, vendido: 0, ticket: null, pctNoPrazo: null, semResposta: null, diasComFato: 0, diasNoMes: 30 });
    expect(linhas[1]).toMatchObject({ mes: "2026-10", leads: 3, pedidosPagos: 2, vendido: 270, ticket: 135, pctNoPrazo: 33, semResposta: 1, respondidas: 2, diasComFato: 1, diasNoMes: 14 });
  });
});

describe("a leitura, com o banco simulado", () => {
  it("recorta pela loja, agrega vendas por netTotal (nunca total), e junta as três fontes", async () => {
    const linhas = await montarTendencia("loja", new Date("2026-10-14T15:00:00.000Z"));
    const clientes = chamadas.find((c) => c.sql.includes('FROM "Customer"'))!;
    expect(clientes.params[0]).toBe("loja");
    const pedidos = chamadas.find((c) => c.sql.includes('FROM "Order"'))!;
    expect(pedidos.sql).toMatch(/SUM\("netTotal"\)/);
    expect(pedidos.sql).not.toMatch(/SUM\("total"\)/);
    expect(pedidos.params).toContainEqual([...PAID_ORDER_STATUSES]);
    const out = linhas.find((l) => l.mes === "2026-10")!;
    expect([out.leads, out.pedidosPagos, out.vendido, out.pctNoPrazo, out.semResposta, out.diasComFato]).toEqual([3, 2, 270, 33, 1, 2]);
    expect(linhas.find((l) => l.mes === "2026-05")).toMatchObject({ leads: 0, vendido: 0, pctNoPrazo: null });
  });
  // A VIRADA DO MÊS no fuso de SP (o cadastro das 22h do dia 30 é de setembro,
  // não de outubro) é provada contra o Postgres de verdade em
  // scripts/e2e-bi.ts (bloco 8) — a conta é do banco, não do simulado.
});
