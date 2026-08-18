import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CHAVINHA "ESCONDER SEM ESTOQUE" — vale por COR, não só por produto.
 *
 * Relato da Entre Linhas (05/08/2026): a chave estava ligada e a cor
 * esgotada continuava na vitrine. Causa: o filtro do servidor tira o
 * PRODUTO quando todas as cores zeram, mas o catálogo desenha um card por
 * COR — o card da cor esgotada ficava enquanto outra cor tivesse peça.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("catálogo: chave 'esconder sem estoque' esconde a COR esgotada", () => {
  it("o card da cor esgotada é pulado quando a chave está ligada", () => {
    const catalogo = ler("src/app/catalogo/[slug]/public-catalog.tsx");
    expect(catalogo).toContain("hideSoldOut && sizes.every((s) => !s.available)");
  });

  it("catálogo geral E catálogo de campanha passam a chave da loja", () => {
    expect(ler("src/app/catalogo/[slug]/montar-catalogo.tsx")).toContain(
      "hideSoldOut={company.catalogHideOutOfStock}"
    );
    expect(ler("src/app/catalogo/[slug]/c/[promo]/page.tsx")).toContain(
      "hideSoldOut={company.catalogHideOutOfStock}"
    );
  });

  it("o filtro do servidor continua tirando o produto todo zerado", () => {
    expect(ler("src/app/catalogo/[slug]/montar-catalogo.tsx")).toContain(
      "variants: { some: { stock: { gt: 0 } } }"
    );
  });
});
