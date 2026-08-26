import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * As 4 melhorias decididas pelo dono em 26/08/2026 (depois da auditoria):
 * investimento por campanha (ROI de verdade), recuperação com uma fonte só,
 * Relatórios com exportação + comparação, e Dashboard sem número repetido.
 * (A enxugada do Dashboard é guardada em numeros-lote4; a fonte única da
 * recuperação, em marketing-honesto.)
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("investimento por campanha → retorno por R$ 1", () => {
  it("o campo existe no banco, com migração escrita à mão (ADR-001)", () => {
    expect(ler("prisma/schema.prisma")).toContain("investment Float   @default(0)");
    expect(
      existsSync(join(raiz, "prisma/migrations/20260826120000_campanha_investimento/migration.sql"))
    ).toBe(true);
  });
  it("a rota de editar campanha aceita o investimento (não-negativo)", () => {
    const rota = ler("src/app/api/marketing/campaigns/[id]/route.ts");
    expect(rota).toContain("investment: z.number().min(0)");
  });
  it("o retorno compara TOTAL com TOTAL (faturamento de toda a vida ÷ investimento)", () => {
    // ROI do investimento total contra o faturamento de uma semana filtrada
    // mentiria — as duas pontas ficam na mesma régua, e o filtro não mexe
    const tela = ler("src/app/(app)/marketing/page.tsx");
    expect(tela).toContain("fatTotalPorCampanha");
    expect(tela).toContain("(fatTotalPorCampanha.get(id) ?? 0) / investido");
  });
  it("sem investimento digitado, a coluna diz '—' (não inventa retorno)", () => {
    const tela = ler("src/app/(app)/marketing/page.tsx");
    expect(tela).toMatch(/r == null\s*\?\s*"—"/);
    expect(tela).toContain("investido > 0 ?");
  });
  it("a loja digita o valor do jeito brasileiro (1.500,00 é 1500, não 1,50)", () => {
    const gestor = ler("src/app/(app)/marketing/campaigns-manager.tsx");
    expect(gestor).toContain("numeroBR(valor)");
    expect(gestor).toContain("Salvar investimento");
  });
});

describe("Relatórios: planilha e comparação com o período anterior", () => {
  const rota = ler("src/app/api/export/relatorio/route.ts");
  const tela = ler("src/app/(app)/relatorios/page.tsx");
  it("a exportação existe, com a régua de acesso DA TELA (gerente para cima)", () => {
    expect(rota).toContain("isManagerUp");
    expect(rota).toContain("status: 403");
  });
  it("a planilha soma o valor vendido (netTotal), nunca o total com frete", () => {
    expect(rota).toContain("netTotal");
    expect(rota).not.toMatch(/select: \{[^}]*\btotal: true/);
  });
  it("a planilha tem as seções principais e a linha da loja", () => {
    for (const secao of ["RESUMO DO PERÍODO", "VENDAS POR DIA", "VENDAS POR VENDEDORA", "LEADS POR CANAL"]) {
      expect(rota).toContain(secao);
    }
    expect(rota).toContain("Loja (sem vendedora)");
  });
  it("o botão de baixar está na tela, levando o período junto", () => {
    expect(tela).toContain("/api/export/relatorio");
    expect(tela).toContain("Baixar planilha (CSV)");
  });
  it("o faturamento compara com o período anterior — sem base, sem invenção", () => {
    expect(tela).toContain("deltaFaturamento");
    expect(tela).toContain("totalAnterior > 0 ?");
    expect(tela).toContain(": null");
  });
  it("a setinha do StatTile tem o estado neutro (0% é 'igual', não 'subiu')", () => {
    const comp = ler("src/components/charts.tsx");
    expect(comp).toContain("const estavel = temDelta && Math.abs(delta!) < 0.05");
  });
});

describe("Inteligência dá carona à varredura da esteira", () => {
  it("abrir a tela conta como tráfego para a varredura (sem cron novo!)", () => {
    const tela = ler("src/app/(app)/inteligencia/page.tsx");
    expect(tela).toContain("after(() => varrerCarrinhosSeDeuAHora())");
  });
});
