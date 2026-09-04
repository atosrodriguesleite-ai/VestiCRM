import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COM_ACENTO_MENSAGEM, SEM_ACENTO_MENSAGEM } from "../busca";

/**
 * A LUPA DA CENTRAL ACHA PALAVRA DENTRO DA CONVERSA, e o emoji tem busca e
 * entra na mensagem editada (pedido do dono, 03/09/2026). Os guardas aqui
 * são do COMPORTAMENTO que a tela e a porta prometem — não do trecho de
 * código exato (lição do incidente das barras do compositor, 28/08/2026).
 */
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
const seletor = ler("src/app/(app)/whatsapp/seletor-de-emoji.tsx");
const loader = ler("src/lib/inbox-data.ts");
const rota = ler("src/app/api/conversations/route.ts");

describe("busca por palavra no servidor (a consulta e o índice)", () => {
  const f = loader.slice(loader.indexOf("export async function buscarMensagens"));

  it("a consulta usa EXATAMENTE a expressão do índice da migração (senão varre a tabela)", () => {
    const migracao = ler("prisma/migrations/20260903120000_busca_palavra_na_mensagem/migration.sql");
    // no código as tabelas de acento entram pelas constantes (uma fonte só);
    // na migração, expandidas — o resultado tem que ser o mesmo texto
    expect(loader).toContain(
      "`to_tsvector('simple', translate(lower(m.body), '${COM_ACENTO_MENSAGEM}', '${SEM_ACENTO_MENSAGEM}'))`"
    );
    expect(migracao).toContain(
      `to_tsvector('simple', translate(lower(body), '${COM_ACENTO_MENSAGEM}', '${SEM_ACENTO_MENSAGEM}'))`
    );
    // sem travar a escrita da maior tabela da loja durante o deploy
    expect(migracao).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(f).toContain("${EXPRESSAO_INDEXADA} @@ to_tsquery('simple', ${consulta})");
  });

  it("é por LOJA no banco (RN-013) e mensagem apagada fica de fora", () => {
    expect(f).toMatch(/c\."companyId" = \$\{user\.companyId\}/);
    expect(f).toMatch(/m\.revoked = false/);
    expect(f).toContain("LIMIT ${MENSAGENS_NA_BUSCA}");
  });

  /**
   * O RECORTE DE QUEM VÊ VAI ANTES DO TETO. Filtrando depois de trazer as N
   * mais recentes, a vendedora que vê só as conversas dela recebia "Nada
   * encontrado" numa loja movimentada: as mais recentes eram todas de
   * colegas (achado da revisão, 03/09/2026). Medido no Postgres local, com
   * 400 mensagens recentes das colegas e a dela mais antiga: antes ela
   * sobrava 0 nas 300 trazidas; agora a busca devolve a dela e só a dela.
   */
  it("o recorte de quem vê entra DENTRO da consulta, antes do teto", () => {
    const recorte = f.indexOf("RECORTE_DE_QUEM_VE(user)");
    const teto = f.indexOf("LIMIT ${MENSAGENS_NA_BUSCA}");
    expect(recorte).toBeGreaterThan(-1);
    expect(recorte).toBeLessThan(teto);
    // e a régua é a MESMA da lista, de um lugar só
    expect(loader).toContain("veTodaAConversa(user)");
    expect(ler("src/lib/scope.ts")).toContain("return veTodaAConversa(user)");
  });

  it("a porta devolve as mensagens achadas junto com as conversas", () => {
    expect(rota).toContain("buscarConversas(user, q)");
    expect(rota).toMatch(/NextResponse\.json\(\{ conversations, mensagens, busca: true \}\)/);
  });
});

describe("a tela mostra onde a palavra apareceu e vai até ela", () => {
  it("a lista pinta o trecho achado no lugar da última mensagem", () => {
    expect(inbox).toContain("achados[c.id][0].trecho.casa");
    expect(inbox).toMatch(/<mark[^>]*>\s*\{achados\[c\.id\]\[0\]\.trecho\.casa\}/);
  });

  it("apagar a busca some com os trechos", () => {
    expect(inbox).toMatch(/if \(q\.length < 2\) \{\s*setAchados\(\{\}\);/);
  });

  it("abrir a conversa pula até a mensagem, carregando o passado se precisar (com teto)", () => {
    const pulo = inbox.slice(inbox.indexOf("PULA ATÉ A MENSAGEM ACHADA PELA LUPA"));
    expect(pulo).toContain("void carregarAnteriores(selected.id)");
    expect(pulo).toContain("paginasDoPulo.current < 25");
    expect(pulo).toContain("setDestaqueMsgId(pulo.id)");
  });

  it("toda bolha tem âncora (nota interna também) para o pulo encontrar", () => {
    expect((inbox.match(/id=\{`msg-\$\{m\.id\}`\}/g) ?? []).length).toBe(2);
  });

  it("a barra ▲▼ anda entre as mensagens achadas da conversa aberta", () => {
    expect(inbox).toContain("irParaAchado(selected.id, posAchado + 1)");
    expect(inbox).toContain("irParaAchado(selected.id, posAchado - 1)");
  });
});

describe("emoji: pesquisa e edição", () => {
  it("o seletor tem barra de pesquisa e usa a busca por palavra", () => {
    expect(seletor).toContain('aria-label="Pesquisar emoji"');
    expect(seletor).toContain("buscarEmojis(termo)");
    // Enter manda o primeiro achado
    expect(seletor).toContain("onEscolher(achados[0])");
  });

  it("o MESMO seletor serve o compositor e a caixa de edição", () => {
    expect(inbox).toContain("onEscolher={insertEmoji}");
    expect(inbox).toContain("onEscolher={inserirEmojiNaEdicao}");
    // a grade não mora mais dentro da tela (uma fonte só, com as palavras)
    expect(inbox).not.toContain("const EMOJI_GROUPS");
  });

  it("a caixa de edição tem o botão de emoji e o seletor insere no campo DELA", () => {
    const edicao = inbox.slice(inbox.indexOf("{editando ? ("), inbox.indexOf("{/* caixinha da mensagem citada"));
    expect(edicao).toContain("<SeletorDeEmoji");
    expect(edicao).toContain("<Smile");
    expect(edicao).toContain("ref={editTaRef}");
  });
});
