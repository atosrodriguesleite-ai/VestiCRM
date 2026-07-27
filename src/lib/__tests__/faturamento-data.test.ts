import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAMPO_DATA_FATURAMENTO,
  CAMPO_VALOR_FATURAMENTO,
  PAID_ORDER_STATUSES,
  computeOrderTotals,
} from "../orders";

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
  "app/(app)/equipe/page.tsx",
  // o MOTOR da tela Inteligência mora aqui — foi o arquivo que escapou na
  // primeira migração justamente por não estar nesta lista
  "lib/tracking/insights.ts",
  // o EXTRATO DE COMISSÃO em PDF: é o papel que a dona usa para pagar, tem
  // que somar pela mesma data que a tela
  "app/api/comissoes/relatorio/route.ts",
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

/**
 * REGRA DO DINHEIRO (2): faturamento soma o VALOR VENDIDO, não o total.
 *
 * `total` inclui o frete — dinheiro que atravessa a loja e vai para a
 * transportadora. Somá-lo inflava o faturamento e podia cair na comissão da
 * vendedora, remunerando ela por um serviço que não é venda.
 *
 * Este teste vigia as telas de dinheiro: se alguém voltar a somar `total`,
 * ele quebra e explica o porquê.
 */
function somasDeTotalNoLugarDoValorVendido(arquivo: string): string[] {
  const fonte = readFileSync(join(raiz, arquivo), "utf8");
  const linhaDe = (pos: number) => fonte.slice(0, pos).split("\n").length;
  const achados: string[] = [];

  // soma agregada no banco: _sum: { total: true }
  for (const m of fonte.matchAll(/_sum:\s*\{[^}]*\btotal:\s*true/g)) {
    achados.push(`${arquivo}:${linhaDe(m.index ?? 0)} (_sum de total)`);
  }
  // soma em memória de pedidos: reduce(... + algo.total ...)
  // `item.total` (linha do pedido) é outra coisa e fica de fora de propósito.
  for (const m of fonte.matchAll(/reduce\([^)]*?\+\s*(?!item\.)(\w+)\.total\b/g)) {
    achados.push(`${arquivo}:${linhaDe(m.index ?? 0)} (reduce somando .total)`);
  }
  return achados;
}

describe("faturamento soma o valor vendido (frete fora)", () => {
  it("a fonte da verdade aponta para netTotal", () => {
    expect(CAMPO_VALOR_FATURAMENTO).toBe("netTotal");
  });

  it("o frete não entra no valor vendido, mas entra no que a cliente paga", () => {
    const t = computeOrderTotals([{ quantity: 1, unitPrice: 1000 }], 0, 150);
    expect(t.netTotal).toBe(1000);
    expect(t.total).toBe(1150);
  });

  it("nenhuma tela de dinheiro soma o total do pedido (que tem frete)", () => {
    const problemas = TELAS_DE_DINHEIRO.flatMap(somasDeTotalNoLugarDoValorVendido);
    expect(
      problemas,
      `Faturamento e comissão somam netTotal (valor vendido = produtos - desconto ` +
        `+ acréscimo). O campo 'total' inclui FRETE e serve só para cobrar. ` +
        `Encontrado em: ${problemas.join(", ")}`
    ).toEqual([]);
  });
});
