import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LOJA SEM VARIAÇÃO DE COR (semijoias, acessórios) — 06/08/2026.
 *
 * A bolinha de cor não faz sentido para semijoias. A solução é POR LOJA:
 * a chave `catalogHideColors` nasce DESLIGADA para todo mundo (nenhuma
 * loja existente muda) e, ligada, o catálogo esconde a bolinha e o nome
 * da cor — no card, na ficha, na sacola e na mensagem do pedido.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("catálogo sem cores é escolha POR LOJA (ninguém mais muda)", () => {
  it("a chave nasce desligada no banco (default false)", () => {
    expect(ler("prisma/schema.prisma")).toContain(
      "catalogHideColors Boolean @default(false)"
    );
    expect(
      ler("prisma/migrations/20260806210000_catalogo_sem_cores/migration.sql")
    ).toContain("DEFAULT false");
  });

  it("o catálogo (geral e campanha) recebe a chave da loja", () => {
    expect(ler("src/app/catalogo/[slug]/montar-catalogo.tsx")).toContain(
      "hideColors={company.catalogHideColors}"
    );
    expect(ler("src/app/catalogo/[slug]/c/[promo]/page.tsx")).toContain(
      "hideColors={company.catalogHideColors}"
    );
  });

  it("com a chave ligada: some do card, da ficha, da sacola e da mensagem", () => {
    const catalogo = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    // card: nome assume o destaque
    expect(catalogo).toContain("hideColors ? (");
    // ficha: pill "Cor:" condicionada
    expect(catalogo).toContain("{!hideColors && (");
    // mensagem do pedido sem a cor
    expect(catalogo).toContain('hideColors ? "" : ` ${c.color}`');
  });

  it("o editor de produto também respeita: grade só por tamanho, cor 'Único'", () => {
    const view = ler("src/app/(app)/produtos/products-view.tsx");
    // editar produto: sem o seletor de cor, a nova variação nasce "Único"
    expect(view).toContain('semCores ? "Único"');
    // produto novo: grade montada sem a etapa de cores
    expect(view).toContain('(semCores ? ["Único"] : selColors)');
    // a tela recebe a MESMA chave da loja usada no catálogo
    expect(ler("src/app/(app)/produtos/page.tsx")).toContain(
      "semCores={company?.catalogHideColors ?? false}"
    );
  });

  it("a chavinha fica no Personalizar catálogo e grava pela API da loja", () => {
    expect(ler("src/app/(app)/configuracoes/catalogo/catalog-designer.tsx")).toContain(
      "catalogHideColors: hideColors"
    );
    expect(ler("src/app/api/company/route.ts")).toContain(
      "catalogHideColors: z.boolean().optional()"
    );
  });
});
