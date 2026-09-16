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
    expect(rota).toContain("syncPaginaDeProdutos(user.companyId, page, desde, undefined, apos)");
    expect(rota).toContain("fim: etapa.fim");
    expect(rota).toContain("parcial: etapa.parcial");
  });

  it("a tela chama etapa por etapa com progresso, e para no fim", () => {
    expect(tela).toContain("body: JSON.stringify({ page, desde, apos })");
    expect(tela).toContain("if (d.fim) {");
    expect(tela).toContain("produtos conferidos até aqui");
    // etapa parcial: a MESMA página, pulando o que já foi feito
    expect(tela).toContain("desde = d.parcial ? (d.desde ?? 0) : 0;");
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
    expect(lib).toContain("if ((page > 1 || comecarEm > 0) && conexao?.lastSyncReport) {");
    expect(lib).toContain("casadas: anterior.casadas + report.casadas");
  });

  it("a Nuvemshop travada não segura a função (timeout de 15s na conversa)", () => {
    expect(lib).toContain("AbortSignal.timeout(15_000)");
  });

  it("etapa que morre sem resposta é repetida 2× antes de desistir, e a mensagem diz ONDE parou", () => {
    expect(tela).toContain("if (!d.error && tentativa < 2) {");
    expect(tela).toContain("ela continua de onde parou");
    expect(tela).toContain("`página ${page}, a partir do produto ${desde + 1}`");
  });

  it("a etapa tem ORÇAMENTO de tempo no servidor e sempre faz pelo menos um produto", () => {
    // Entre Linhas, 15/09/2026: a página lenta morria nos 60s da Vercel sem
    // resposta, e a lojista recomeçava da 1 para morrer no mesmo lugar
    expect(lib).toContain("export const MS_ORCAMENTO_DA_ETAPA = 25_000;");
    expect(lib).toContain("if (feitos > 0 && Date.now() - inicio > orcamentoMs) {");
    expect(lib).toContain("const proximaPagina = parcial ? page : page + 1;");
    // a página pode ter mudado de ordem entre as duas chamadas: retoma pelo id
    expect(lib).toContain("if (i >= 0) comecarEm = i + 1;");
  });

  it("deixa rastro de ONDE está antes de trabalhar, e o cartão mostra onde parou", () => {
    expect(lib).toContain("await rastro(page, desde);");
    expect(lib).toContain("if (!fim) await rastro(proximaPagina, proximoDesde);");
    expect(lib).toContain("lastSyncEtapa: null");
    expect(tela).toContain("A última sincronização não chegou ao fim: parou na página");
    // e o botão RETOMA de lá (prometer "continua de onde parou" e recomeçar da 1 era mentira)
    expect(tela).toContain("let page = estado?.etapaParada?.pagina ?? 1;");
    expect(tela).toContain("if (!fim) return falhou({}, `página ${page}, a partir do produto ${desde + 1}`);");
  });

  it("baixa pendente (RN-053) e preço a caminho (RN-057) são lidos UMA vez por rodada, não por produto", () => {
    expect(lib).toContain("estoquePendente: await variacoesComEnvioPendente(companyId),");
    expect(lib).toContain("precosPendentes: await produtosComPrecoPendente(companyId),");
    expect(lib).toContain("pools?.estoquePendente ??");
    // o pool é atalho: número DIFERENTE reconfere a fila na hora (venda que
    // entrou no meio da etapa não pode ser desfeita pelo número de lá)
    expect(lib).toContain("(alvo.stock !== stock && (await envioPendentePorVariacao(companyId, [alvo.id])).has(alvo.id))");
    // e a variação só vai ao banco quando algo mudou
    expect(lib).toContain("if (Object.keys(dadosDaVariacao).length > 0) {");
  });
});
