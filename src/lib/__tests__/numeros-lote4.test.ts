import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LOTE 4 — NÚMEROS QUE NÃO BATEM (auditoria 07/08/2026). Guardas de arquivo:
 * conversão por coorte, meta do mês, ranking na carteira certa, comissão
 * centavo a centavo com a regra atual, funil com o valor do pedido e placar
 * de recuperação honesto.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("Dashboard: conversão nunca passa de 100%", () => {
  const dash = ler("src/app/(app)/dashboard/page.tsx");
  it("numerador e denominador vêm da MESMA coorte (criados no período)", () => {
    expect(dash).toContain("cohortPaid30 / ordersGenerated30");
    expect(dash).toContain("prevCohortPaid / prevOrdersGenerated");
    expect(dash).toContain("coorte-ok");
  });
  it("a vendedora vê o ranking SÓ com as vendas dela (não da loja inteira)", () => {
    expect(dash).toContain("const allSales30 = sales30");
  });
  it("cartão 'Sem contato 7+' usa contagem real, não o tamanho da lista de 6", () => {
    expect(dash).toContain("value={noContactCount}");
  });
  it("cartão de pedidos diz '30d' (não finge ser o mês do calendário)", () => {
    expect(dash).toContain('"Pagos (30d)"');
  });
  it("mais vendidos agrupam pelo PRODUTO com o nome ATUAL (renomear junta o histórico)", () => {
    expect(dash).toContain('by: ["productId", "name"]');
    expect(dash).toContain("nomeAtual.get(chave)");
    expect(dash).toContain("somaPorNome");
  });
});

describe("Inteligência: Categorias, Cores e Tamanhos contam as MESMAS peças", () => {
  const ins = ler("src/lib/tracking/insights.ts");
  it("venda E acesso amarram no produto ATUAL (renomear não divide em duas linhas)", () => {
    expect(ins).toContain("cadastroAtual(item.productId, item.name)");
    expect(ins).toContain("cadastroAtual(e.productId, e.productName)");
    expect(ins).not.toContain("catByName.get(item.name)"); // o jeito antigo, que perdia renomeados
  });
  it("peça sem cor/tamanho/categoria entra na conta (não é descartada)", () => {
    expect(ins).toContain('"Sem cor"');
    expect(ins).toContain('"Sem tamanho"');
    expect(ins).toContain('"Sem categoria"');
  });
  it("cor/tamanho aparados dos DOIS lados (espaço a mais não vira linha dupla)", () => {
    expect(ins).toContain("e[dim]?.trim()");
    expect(ins).toContain("item.color?.trim()");
    expect(ins).toContain("item.size?.trim()");
  });
  it("xarás no cadastro: plano B por nome é determinístico (o mais antigo vence)", () => {
    expect(ins).toContain("if (!porNome.has(pr.name)) porNome.set(pr.name, pr)");
    expect(ins).toContain('orderBy: [{ createdAt: "asc" }');
  });
});

describe("Equipe: a meta é do MÊS (fuso SP), não de 30 dias corridos", () => {
  it("a página calcula o vendido do mês separado das vendas 30d", () => {
    const pg = ler("src/app/(app)/equipe/page.tsx");
    expect(pg).toContain("soldMonth");
    expect(pg).toContain("startOfMonth");
  });
  it("a barra da meta usa o vendido do mês", () => {
    const view = ler("src/app/(app)/equipe/team-view.tsx");
    expect(view).toContain("m.soldMonth / m.monthlyGoal");
    expect(view).not.toContain("m.sales30 / m.monthlyGoal");
  });
});

describe("Extrato de comissão: regra atual e centavos que batem", () => {
  const pdf = ler("src/app/api/comissoes/relatorio/route.ts");
  it("a regra impressa é a do LINK (a antiga, da responsável, foi revogada)", () => {
    expect(pdf).toContain("quem MANDOU O LINK");
    expect(pdf).not.toContain("RESPONSÁVEL pela cliente");
  });
  it("comissão arredondada POR LINHA e total somando as linhas", () => {
    expect(pdf).toContain("comissaoDaLinha");
    expect(pdf).toContain("orders.reduce((s, o) => s + comissaoDaLinha(o), 0)");
  });
  it("a tela de comissões segue a mesma régua de centavos", () => {
    const tela = ler("src/app/(app)/comissoes/commissions-view.tsx");
    expect(tela).toContain("Math.round(((r.base * rate) / 100) * 100) / 100");
  });
});

describe("Funil: o valor do cartão acompanha o pedido", () => {
  it("ganhar a oportunidade grava o valor VENDIDO do pedido", () => {
    const sync = ler("src/lib/opportunity-sync.ts");
    expect(sync).toContain("value: pedido.netTotal");
  });
  it("criar pedido (sistema e catálogo) sincroniza o valor no nascimento", () => {
    // `cartao` = o cartão amarrado ao pedido, garantido no nascimento (funil vivo)
    expect(ler("src/app/api/orders/route.ts")).toContain(
      "syncOpportunityValue(user.companyId, cartao, order.netTotal)"
    );
    expect(ler("src/app/api/catalog/order/route.ts")).toContain(
      "syncOpportunityValue(company.id, cartao, order.netTotal)"
    );
  });
});

describe("Recuperação: placar sem inflar", () => {
  const rec = ler("src/lib/recuperacao.ts");
  it("compra só conta como recuperação dentro da janela de 30 dias", () => {
    expect(rec).toContain("JANELA de 30 dias");
  });
  it("o crédito nunca passa do valor da sacola abandonada", () => {
    expect(rec).toContain("Math.min(pagoDeVerdade, c.value)");
  });
  it("recuperado À MÃO também amarra o pedido (não conta em dobro)", () => {
    const rota = ler("src/app/api/recuperacao/[id]/route.ts");
    expect(rota).toContain("recoveredOrderId");
    expect(rota).toContain("PAID_ORDER_STATUSES");
  });
});

describe("Relatórios: gráfico e tiles honestos", () => {
  const rel = ler("src/app/(app)/relatorios/page.tsx");
  it("blocos ancorados no INÍCIO (só a última barra pode ser parcial)", () => {
    expect(rel).toContain("periodo.from.getTime() + i * passoMs");
  });
  it("tiles de base inteira carregam a marca 'histórico'", () => {
    expect(rel).toContain("· histórico");
  });
});

describe("o guarda do dinheiro cobre as exportações", () => {
  const guarda = ler("src/lib/__tests__/faturamento-data.test.ts");
  it("export de pedidos e de clientes estão na varredura", () => {
    expect(guarda).toContain('"app/api/export/pedidos/route.ts"');
    expect(guarda).toContain('"app/api/export/clientes/route.ts"');
  });
  it("formatar/exibir .total sem marcador também acusa", () => {
    expect(guarda).toContain("uso de .total em função");
  });
});
