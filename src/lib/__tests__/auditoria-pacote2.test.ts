import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pacote 2 da auditoria de 24/08/2026 (Dashboard, Relatórios, Marketing,
 * Inteligência): os 12 achados menores + a segurança dos CSVs. Cada guarda
 * abaixo tranca um número que estava errado ou um rótulo que mentia.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("CSV: fórmula maliciosa neutralizada em TODAS as exportações", () => {
  // célula começando com = + - @ vira comando ao abrir no Excel/Sheets — e
  // clientes e conversas carregam texto digitado pela própria cliente
  for (const rota of ["pedidos", "clientes", "conversas"]) {
    it(`export de ${rota} escapa o começo perigoso da célula`, () => {
      const fonte = ler(`src/app/api/export/${rota}/route.ts`);
      expect(fonte).toContain("/^[=+\\-@\\t\\r]/");
      expect(fonte).toContain("`'${s}`");
    });
  }
});

describe("Dashboard: rodapés e contadores honestos", () => {
  const dash = ler("src/app/(app)/dashboard/page.tsx");
  it("cancelado não é 'sem pagamento' (e aparece à parte quando existe)", () => {
    expect(dash).toContain("canceladosPeriodo");
    expect(dash).toContain("ordersGenerated30 - cohortPaid30 - canceladosPeriodo");
    expect(dash).toContain("cancelados");
  });
  it("'em fechamento' conta pela POSIÇÃO da etapa, não pelo nome", () => {
    // renomear "Pedido em negociação" travava o contador em zero
    expect(dash).not.toContain('name: { in: ["Pedido em negociação"');
    expect(dash).toContain("etapasDeFechamento");
    expect(dash).toContain(".slice(-2)");
  });
  it("período gigante não corta o gráfico em silêncio", () => {
    expect(dash).toContain("TETO_DIAS_GRAFICO");
    expect(dash).toContain("graficoCortado");
    expect(dash).toContain("mostrando os primeiros 4 anos do período");
  });
  it("gráfico agrupado por semana DIZ que é por semana", () => {
    expect(dash).toContain("agrupadoPorSemana");
    expect(dash).toContain("· por semana");
    expect(dash).toContain("Período longo agrupa por SEMANA");
  });
});

describe("cartões: variação 0% é 'igual', não 'subiu'", () => {
  const card = ler("src/components/dash.tsx");
  it("o selo tem o estado neutro (sem seta verde no zero)", () => {
    expect(card).toContain("const estavel = temDelta && Math.abs(delta!) < 0.05");
    expect(card).toContain('"bg-slate-100 text-slate-500"');
    expect(card).toContain('{estavel ? "igual ao" : sobe ? "acima do" : "abaixo do"}');
  });
});

describe("Marketing: rosca e barra de canais fecham com os totais", () => {
  const mkt = ler("src/app/(app)/marketing/page.tsx");
  it("do 7º canal em diante vira 'Outros canais' (não é descartado)", () => {
    expect(mkt).toContain("Outros canais");
    expect(mkt).toContain("canaisComFat.slice(6)");
  });
  it("a barra de leads ordena POR LEADS e também agrupa o resto", () => {
    // `canais` vem ordenado por faturamento — o top-6 de leads era o top-6
    // de FAT, e o canal líder em leads podia sumir da própria barra
    expect(mkt).toContain("sort((a, b) => b.leads - a.leads)");
    expect(mkt).toContain("restoLeads");
  });
});

describe("Bio: uma fonte só de cliques e 'Hoje' no dia de São Paulo", () => {
  const bio = ler("src/app/api/marketing/bio/report/route.ts");
  it("'Tudo' conta clique de botão apagado e o total é a SOMA do ranking", () => {
    // o "Tudo" somava os contadores dos botões vivos — apagar um botão
    // deixava o "Tudo" MENOR que o "7 dias"; e total calculado separado do
    // ranking descolava os dois números
    expect(bio).toContain("Botão apagado");
    expect(bio).toContain("Math.max(l.clicks, eventosPorLink.get(l.id) ?? 0)");
    expect(bio).toContain("linhas.reduce((s, l) => s + l.clicks, 0)");
  });
  it("'Hoje' é o dia de SP, não as últimas 24h corridas", () => {
    expect(bio).toContain("periodFromDays(1).from");
  });
});

describe("Relatórios: período que vale para tudo que está na seção", () => {
  const rel = ler("src/app/(app)/relatorios/page.tsx");
  it("'1ª resposta' só conta conversas que CHEGARAM no período", () => {
    expect(rel).toContain("if (!noPeriodo(entrada)) continue;");
    expect(rel).toContain("do período respondida");
  });
  it("vendas por vendedor mostram a linha da LOJA (pedido sem dona)", () => {
    // sem ela, as barras somavam menos que o cartão de Faturamento
    expect(rel).toContain('"Loja (sem vendedora)"');
    expect(rel).toContain("!v.sellerId");
  });
});

describe("Inteligência: alertas e 'cliente voltou' falam a verdade", () => {
  const fonte = ler("src/lib/tracking/insights.ts");
  const tela = ler("src/app/(app)/inteligencia/page.tsx");
  it("alertas têm régua FIXA (não seguem o filtro da tela)", () => {
    // com filtro de 1 ano, mandava revisar preço de peça parada há meses,
    // com selo de "24h"
    expect(fonte).toContain("export async function alerts(companyId: string)");
    expect(fonte).toContain("const semanaViva = periodFromDays(7)");
  });
  it("o selo da tela descreve a régua fixa", () => {
    expect(tela).not.toContain("· últimas 24h");
    expect(tela).toContain("independe do filtro");
  });
  it("'cliente voltou' é a visita que CRUZA 30+ dias de ausência, no período", () => {
    // três armadilhas: última−PRIMEIRA disparava toda semana; medir só as
    // duas últimas apagava o card quando a cliente reabria o link à tarde;
    // exigir lastSeenAt ≤ fim escondia a volta de julho de quem visitou de
    // novo em agosto
    expect(fonte).toContain("if (sessoes[i] > p.to || sessoes[i] < p.from) continue;");
    expect(fonte).toContain("if (dias >= 30)");
    expect(fonte).toContain("lastSeenAt: { gte: p.from },");
    // e a consulta tem teto (não puxa a história inteira das fiéis)
    expect(fonte).toContain("400 * 24 * 60 * 60 * 1000");
  });
  it("alertas nomeiam só quem apareceu hoje (sem carregar a loja inteira)", () => {
    expect(fonte).toContain("idsDeHoje");
  });
});
