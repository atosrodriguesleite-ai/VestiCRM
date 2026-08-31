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
    // a busca acontece FORA do laço de produtos (uma vez por sincronização)
    expect(lib).toContain("const poolSku = await buscarPoolSku(companyId);");
    expect(lib).toContain("upsertProduct(companyId, p, report, pools)");
  });

  it("o índice dos SKUs parecidos também é montado UMA vez (vai junto no pool)", () => {
    // refazer por produto custava um normalize() por variação do catálogo a
    // cada peça — na função que já morreu no teto de 60s da Vercel
    expect(lib).toContain("idxParecidos: indiceDeSkusParecidos(poolSku)");
    expect(lib).toContain("pools?.idxParecidos ?? indiceDeSkusParecidos(skuVariants)");
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

describe("sincronização EM ETAPAS — não existe catálogo que estoure o tempo", () => {
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/nuvemshop/sync/route.ts"),
    "utf8"
  );
  const tela = readFileSync(
    join(process.cwd(), "src/app/(app)/configuracoes/nuvemshop-connect.tsx"),
    "utf8"
  );

  it("cada chamada processa UMA página e diz se acabou", () => {
    expect(lib).toContain("export async function syncPaginaDeProdutos");
    expect(rota).toContain("syncPaginaDeProdutos(user.companyId, page)");
    expect(rota).toContain("fim: etapa.fim");
  });

  it("a tela chama etapa por etapa com progresso, e para no fim", () => {
    expect(tela).toContain("body: JSON.stringify({ page })");
    expect(tela).toContain("if (d.fim) break;");
    expect(tela).toContain("produtos conferidos até aqui");
  });

  it("os carrinhos abandonados têm etapa PRÓPRIA (nunca junto dos produtos)", () => {
    // importar carrinho cria cliente/conversa — pesado; junto com os
    // produtos na mesma requisição já derrubou a rodada
    expect(rota).toContain("if (body?.carrinhos === true) {");
    expect(tela).toContain("body: JSON.stringify({ carrinhos: true })");
  });

  it("etapa lenta (>30s) fica registrada no painel Saúde", () => {
    expect(rota).toContain("etapa lenta");
    expect(rota).toContain("30_000");
  });

  it("o relatório soma entre as etapas e a etapa 1 recomeça", () => {
    expect(lib).toContain("if (page > 1 && conexao?.lastSyncReport) {");
    expect(lib).toContain("casadas: anterior.casadas + report.casadas");
  });

  it("a Nuvemshop travada não segura a função (timeout de 15s na conversa)", () => {
    expect(lib).toContain("AbortSignal.timeout(15_000)");
  });

  it("quando ainda assim falhar, a tela instrui (tente de novo, é seguro)", () => {
    expect(tela).toContain("segura de repetir");
  });
});
