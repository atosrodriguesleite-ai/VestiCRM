import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { motivoOculto, contarOcultas } from "../catalogo/visibilidade";

/**
 * "TEM UM PRODUTO QUE NÃO ESTÁ APARECENDO NO CATÁLOGO DO CLIENTE."
 *
 * Caso real (Toque Leve, 07/08/2026). A peça existia, tinha foto, tinha preço
 * — e a cliente não via. A tela de Produtos não dizia nada útil: mostrava o
 * selo "Sem estoque", que a lojista lê como "aparece, mas esgotado".
 *
 * Este teste garante duas coisas:
 *  1. o diagnóstico responde certo em cada uma das quatro situações;
 *  2. o diagnóstico continua colado nas regras REAIS da vitrine — se alguém
 *     mexer no filtro do catálogo, o teste cobra o ajuste aqui.
 */

const peca = (over: Partial<Parameters<typeof motivoOculto>[0]> = {}) => ({
  active: true,
  images: [{ id: "f1" }],
  variants: [{ stock: 3 }],
  nuvemshopId: null,
  ...over,
});

const NO_AR = { esconderSemEstoque: false };
const ESCONDENDO = { esconderSemEstoque: true };

describe("por que a peça não aparece no catálogo", () => {
  it("peça completa está no ar (sem motivo nenhum)", () => {
    expect(motivoOculto(peca(), NO_AR)).toBeNull();
    expect(motivoOculto(peca(), ESCONDENDO)).toBeNull();
  });

  it("peça desativada não entra", () => {
    expect(motivoOculto(peca({ active: false }), NO_AR)?.codigo).toBe("INATIVO");
  });

  it("peça sem foto não entra — a vitrine exige imagem", () => {
    expect(motivoOculto(peca({ images: [] }), NO_AR)?.codigo).toBe("SEM_FOTO");
  });

  it("PEÇA SEM GRADE some sem ninguém perceber — era o buraco mais silencioso", () => {
    // o catálogo desenha um card POR COR: sem cor cadastrada, não há card.
    // O produto passa por TODOS os filtros do banco e mesmo assim não aparece.
    const m = motivoOculto(peca({ variants: [] }), NO_AR);
    expect(m?.codigo).toBe("SEM_GRADE");
    expect(m?.comoResolver).toMatch(/\+/); // manda clicar no + (a armadilha real)
  });

  it("zerada só some quando a loja pediu para esconder o que não tem estoque", () => {
    const zerada = peca({ variants: [{ stock: 0 }, { stock: 0 }] });
    expect(motivoOculto(zerada, NO_AR)).toBeNull();
    expect(motivoOculto(zerada, ESCONDENDO)?.codigo).toBe("SEM_ESTOQUE");
  });

  it("uma cor com estoque já basta para a peça ficar no ar", () => {
    const quase = peca({ variants: [{ stock: 0 }, { stock: 1 }] });
    expect(motivoOculto(quase, ESCONDENDO)).toBeNull();
  });

  it("estoque negativo não conta como estoque", () => {
    const bug = peca({ variants: [{ stock: -2 }] });
    expect(motivoOculto(bug, ESCONDENDO)?.codigo).toBe("SEM_ESTOQUE");
  });

  it("peça da loja online inativa avisa da Nuvemshop (senão volta a sumir sozinha)", () => {
    const espelho = motivoOculto(peca({ active: false, nuvemshopId: "123" }), NO_AR);
    expect(espelho?.comoResolver).toMatch(/Nuvemshop/i);
    const propria = motivoOculto(peca({ active: false }), NO_AR);
    expect(propria?.comoResolver).not.toMatch(/Nuvemshop/i);
  });

  it("todo motivo vem com selo curto, explicação e próximo passo", () => {
    const casos = [
      peca({ active: false }),
      peca({ images: [] }),
      peca({ variants: [] }),
      peca({ variants: [{ stock: 0 }] }),
    ];
    for (const c of casos) {
      const m = motivoOculto(c, ESCONDENDO)!;
      expect(m.curto.length).toBeGreaterThan(0);
      expect(m.curto.length).toBeLessThanOrEqual(20); // cabe no selo do card
      expect(m.motivo.length).toBeGreaterThan(20);
      expect(m.comoResolver.length).toBeGreaterThan(20);
    }
  });

  it("conta quantas peças estão fora do ar", () => {
    const lista = [peca(), peca({ active: false }), peca({ images: [] }), peca()];
    expect(contarOcultas(lista, NO_AR)).toBe(2);
  });
});

describe("o diagnóstico segue a regra REAL da vitrine", () => {
  const catalogo = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/montar-catalogo.tsx"),
    "utf8"
  );
  const vitrine = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("o catálogo filtra por ativo, foto e (opcional) estoque", () => {
    // se algum destes sair/mudar, o diagnóstico passa a mentir para a lojista
    expect(/active:\s*true/.test(catalogo)).toBe(true);
    expect(/images:\s*\{\s*some:\s*\{\s*\}\s*\}/.test(catalogo)).toBe(true);
    expect(/catalogHideOutOfStock/.test(catalogo)).toBe(true);
    expect(/variants:\s*\{\s*some:\s*\{\s*stock:\s*\{\s*gt:\s*0\s*\}/.test(catalogo)).toBe(
      true
    );
  });

  it("a vitrine continua desenhando um card POR COR (é o que derruba a peça sem grade)", () => {
    expect(/new Set\(p\.variants\.map\(\(v\) => v\.color\)\)/.test(vitrine)).toBe(true);
  });
});

describe("a grade não perde variação digitada", () => {
  const tela = readFileSync(
    join(process.cwd(), "src/app/(app)/produtos/products-view.tsx"),
    "utf8"
  );

  it("o salvar resgata a linha que ficou sem o +", () => {
    expect(
      /novaMexida/.test(tela),
      "Sem esse marcador, escolher cor/tamanho e clicar em Salvar (sem o +) " +
        "descarta a variação em silêncio — foi assim que a cor não chegou ao catálogo."
    ).toBe(true);
  });

  it("o botão + responde quando não dá para adicionar", () => {
    expect(/setAvisoGrade/.test(tela)).toBe(true);
  });

  it("o card usa o diagnóstico, não uma régua própria", () => {
    expect(/motivoOculto/.test(tela)).toBe(true);
  });
});
