import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ORDEM DAS CATEGORIAS — incidente Entre Linhas (03/08/2026): a tela listava
 * só categorias de produto ATIVO; produto pausado e categoria criada à mão
 * sumiam da lista e a lojista via "faltando categoria".
 */
describe("a tela de ordem lista TODAS as categorias da loja", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/(app)/configuracoes/catalogo/page.tsx"),
    "utf8"
  );

  it("sem filtro de ativo (produto pausado também conta)", () => {
    /*
     * A régua é da consulta de PRODUTOS. Checar só "não existe `active:
     * true` na página" era frouxo demais: ele acusava qualquer OUTRA
     * consulta que filtrasse por ativo com razão — foi o que aconteceu
     * quando a página passou a listar os links de tabela de preço vivos
     * para o catálogo em PDF (RN-094). Agora a guarda olha a consulta
     * certa, pelo bloco dela.
     */
    const produtos = page.match(/db\.product\.findMany\(\{[\s\S]*?\}\),/)?.[0] ?? "";
    expect(produtos).toContain("companyId: user.companyId");
    expect(produtos).not.toContain("active: true");
  });

  it("categoria criada à mão (extraCategories) entra na lista", () => {
    expect(page).toContain("parseCategoryOrder(company.extraCategories)");
  });
});
