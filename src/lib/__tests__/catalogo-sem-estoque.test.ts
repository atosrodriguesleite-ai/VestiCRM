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
    // a régua do card por cor mora na lib desde a RN-094 (o catálogo em PDF
    // usa a MESMA), e a vitrine a importa — duas cópias envelheceriam
    expect(ler("src/lib/catalogo/secoes.ts")).toContain(
      "hideSoldOut && sizes.every((s) => !s.available)"
    );
    expect(ler("src/app/catalogo/[slug]/public-catalog.tsx")).toContain("cardsDaPeca(p, hideSoldOut)");
  });

  it("catálogo geral E catálogo de campanha passam a chave da loja", () => {
    expect(ler("src/app/catalogo/[slug]/montar-catalogo.tsx")).toContain(
      "hideSoldOut={company.catalogHideOutOfStock}"
    );
    expect(ler("src/app/catalogo/[slug]/c/[promo]/page.tsx")).toContain(
      "hideSoldOut={company.catalogHideOutOfStock}"
    );
  });

  it("o filtro do servidor continua tirando o produto todo zerado (salvo a peça sob encomenda, RN-076)", () => {
    // a leitura do acervo mora na lib desde a RN-094 (vitrine e PDF a chamam)
    expect(ler("src/lib/catalogo/acervo.ts")).toContain(
      "ondeNaoEscondePorEstoque(catsSobEncomenda)"
    );
    expect(ler("src/lib/catalogo/sob-encomenda-na-vitrine.ts")).toContain(
      "variants: { some: { stock: { gt: 0 } } }"
    );
  });
});
