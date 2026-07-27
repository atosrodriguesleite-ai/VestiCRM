import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAMPO_DATA_FATURAMENTO, PAID_ORDER_STATUSES } from "../orders";

/**
 * REGRA DO DINHEIRO: faturamento é somado pela data do PAGAMENTO.
 *
 * Orçamento montado em julho e pago em agosto conta em AGOSTO — assim o mês
 * bate com o extrato e um mês já fechado nunca mais muda de valor.
 *
 * Este teste vigia as telas de dinheiro: se alguém voltar a filtrar pedido
 * pago por `createdAt`, ele quebra e explica o porquê. É a trava que impede
 * a regra de se perder com o tempo.
 */

const raiz = join(process.cwd(), "src");

const TELAS_DE_DINHEIRO = [
  "app/(app)/dashboard/page.tsx",
  "app/(app)/relatorios/page.tsx",
  "app/(app)/comissoes/page.tsx",
  "app/(app)/financeiro/page.tsx",
  "app/(app)/inteligencia/page.tsx",
  "app/(app)/marketing/page.tsx",
];

/**
 * Consultas de pedido PAGO que ainda filtram por data de criação.
 *
 * Olha CONSULTA POR CONSULTA (cada `db.<algo>.<método>({`), e não linha a
 * linha: senão a consulta vizinha de "pedidos GERADOS no período" — que usa
 * `createdAt` de propósito, por ser o denominador da conversão — cairia como
 * falso alarme.
 */
function consultasDePagoComDataDeCriacao(arquivo: string): string[] {
  const fonte = readFileSync(join(raiz, arquivo), "utf8");
  const linhaDe = (pos: number) => fonte.slice(0, pos).split("\n").length;
  const achados: string[] = [];
  const inicios = [...fonte.matchAll(/db\.\w+\.\w+\(\{/g)];
  inicios.forEach((m, idx) => {
    const ini = m.index ?? 0;
    const fim = idx + 1 < inicios.length ? inicios[idx + 1].index ?? fonte.length : fonte.length;
    const consulta = fonte.slice(ini, fim);
    const ehPago =
      /PAID_ORDER_STATUSES/.test(consulta) ||
      /\.\.\.orderScope/.test(consulta) ||
      /\.\.\.paidScope/.test(consulta);
    // "qualquer status" é a consulta de pedidos gerados: createdAt é o certo lá
    const ehQualquerStatus = /orderAnyScope/.test(consulta);
    if (ehPago && !ehQualquerStatus && /createdAt:\s*(inPeriod|inPrev|\{)/.test(consulta)) {
      achados.push(`${arquivo}:${linhaDe(ini)}`);
    }
  });
  return achados;
}

describe("faturamento conta pela data do pagamento", () => {
  it("a fonte da verdade aponta para paidAt", () => {
    expect(CAMPO_DATA_FATURAMENTO).toBe("paidAt");
    // pedido só é venda a partir de pago (regra que sustenta a data)
    expect(PAID_ORDER_STATUSES).toContain("PAGO");
    expect(PAID_ORDER_STATUSES).not.toContain("ORCAMENTO");
  });

  it("nenhuma tela de dinheiro filtra pedido pago pela data de criação", () => {
    const problemas = TELAS_DE_DINHEIRO.flatMap(consultasDePagoComDataDeCriacao);
    expect(
      problemas,
      `Faturamento tem que ser somado por paidAt (data do pagamento), não por ` +
        `createdAt (data em que o orçamento foi montado). Encontrado em: ${problemas.join(", ")}`
    ).toEqual([]);
  });
});
