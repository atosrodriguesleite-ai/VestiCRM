import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SYNC QUE ESTOURAVA O TEMPO — incidente Entre Linhas (03/08/2026).
 *
 * Ela lançou produtos novos na Nuvemshop e o "Sincronizar agora" morria em
 * "Não foi possível sincronizar": o `upsertProduct` consultava o catálogo
 * INTEIRO (todas as variações com SKU + todos os produtos) PARA CADA produto
 * da Nuvemshop — com o catálogo grande, a rodada passava dos 60s e a Vercel
 * matava a função no meio, sem mensagem nenhuma.
 */

const lib = readFileSync(join(process.cwd(), "src/lib/nuvemshop.ts"), "utf8");

describe("a sincronização completa não relê o catálogo por produto", () => {
  it("os pools são buscados UMA vez na syncProducts e repassados", () => {
    expect(lib).toContain("const pools: PoolsDeSync = {");
    expect(lib).toContain("skuVariants: await buscarPoolSku(companyId)");
    expect(lib).toContain("upsertProduct(companyId, p, report, pools)");
  });

  it("upsertProduct usa o pool recebido em vez de consultar de novo", () => {
    expect(lib).toContain("pools ? pools.skuVariants : buscarPoolSku(companyId)");
    expect(lib).toContain("pools ? pools.allProducts : buscarPoolProdutos(companyId)");
  });

  it("produto espelhado na rodada entra no pool (paginação repetida não duplica)", () => {
    expect(lib).toContain("pools.allProducts.push({");
  });

  it("a etiqueta de cor lê uma vez e só grava onde falta (não pesa a rodada)", () => {
    expect(lib).toContain("if (mapa.size === 0) return;");
    expect(lib).toContain("where: { productId, color: null, url: { in: [...mapa.keys()] } }");
  });
});

describe("quando ainda assim estourar, a lojista sabe o que fazer", () => {
  it("a tela troca o beco sem saída por instrução (tente de novo, é seguro)", () => {
    const tela = readFileSync(
      join(process.cwd(), "src/app/(app)/configuracoes/nuvemshop-connect.tsx"),
      "utf8"
    );
    expect(tela).toContain("segura de repetir");
  });
});
