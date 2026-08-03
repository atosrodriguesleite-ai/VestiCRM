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
    expect(page).not.toContain("companyId: user.companyId, active: true");
  });

  it("categoria criada à mão (extraCategories) entra na lista", () => {
    expect(page).toContain("parseCategoryOrder(company.extraCategories)");
  });
});
