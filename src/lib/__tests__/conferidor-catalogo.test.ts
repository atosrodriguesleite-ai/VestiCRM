import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CONFERIDOR DE CATÁLOGO — a resposta vem do BANCO, não da tela.
 *
 * A loja dizia "a peça está certa" e a cliente continuava sem ver. Adivinhar
 * não resolveu duas vezes. Esta rota roda a MESMA consulta da vitrine, presa
 * a uma peça só, e ainda diz se o LINK enviado (catálogo de campanha) inclui
 * a peça — que é o caso em que está tudo certo e mesmo assim a cliente não vê.
 *
 * Este teste existe para o conferidor não virar mentira: se o filtro da
 * vitrine mudar e o da rota não, ele quebra.
 */

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const rota = ler("src/app/api/products/[id]/catalogo/route.ts");
const vitrine = ler("src/app/catalogo/[slug]/montar-catalogo.tsx");
const campanha = ler("src/app/catalogo/[slug]/c/[promo]/page.tsx");
const tela = ler("src/app/(app)/produtos/products-view.tsx");

describe("o conferidor usa o filtro REAL da vitrine", () => {
  it("exige peça ativa, com foto — igual à vitrine", () => {
    for (const fonte of [rota, vitrine]) {
      expect(/active:\s*true/.test(fonte)).toBe(true);
      expect(/images:\s*\{\s*some:\s*\{\s*\}\s*\}/.test(fonte)).toBe(true);
    }
  });

  it("respeita a chavinha 'esconder sem estoque' da loja", () => {
    for (const fonte of [rota, vitrine]) {
      expect(/catalogHideOutOfStock/.test(fonte)).toBe(true);
      expect(
        /variants:\s*\{\s*some:\s*\{\s*stock:\s*\{\s*gt:\s*0\s*\}/.test(fonte)
      ).toBe(true);
    }
  });

  it("nunca sai da loja de quem perguntou (multi-tenant)", () => {
    expect(/companyId:\s*user\.companyId/.test(rota)).toBe(true);
    // a peça é buscada com o companyId junto — id sozinho vazaria entre lojas
    expect(/findFirst\(\{\s*where:\s*\{\s*id,\s*companyId:\s*user\.companyId/.test(rota)).toBe(
      true
    );
  });

  it("é somente leitura — conferir não pode mexer em nada", () => {
    expect(/db\.\w+\.(create|update|delete|upsert|createMany|updateMany)/.test(rota)).toBe(
      false
    );
  });
});

describe("o conferidor responde o caso 'está tudo certo e ela não vê'", () => {
  it("olha os catálogos de CAMPANHA, que só têm peças selecionadas", () => {
    // é o filtro que a peça certa não passa: o link da campanha tem lista
    expect(/promoCatalog\.findMany/.test(rota)).toBe(true);
    expect(/id:\s*\{\s*in:\s*selected\s*\}/.test(campanha)).toBe(true);
  });

  it("avisa quando a loja inteira está suspensa", () => {
    expect(/lojaSuspensa/.test(rota)).toBe(true);
    expect(/suspended/.test(vitrine)).toBe(true);
  });

  it("responde cor por cor (a vitrine desenha um card por COR)", () => {
    expect(/cores/.test(rota)).toBe(true);
    expect(/new Set\(produto\.variants\.map\(\(v\) => v\.color\)\)/.test(rota)).toBe(true);
  });
});

describe("a ficha da peça tem o botão", () => {
  it("dá para conferir sem sair da tela de Produtos", () => {
    expect(/conferirCatalogo/.test(tela)).toBe(true);
    expect(tela).toContain("A cliente está vendo esta peça?");
  });
});
