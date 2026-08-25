import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * REAGIR À MENSAGEM COM EMOJI (pedido do dono, 25/08/2026).
 *
 * Quatro coisas quebram em silêncio se alguém mexer sem saber — e todas as
 * quatro já morderam este sistema em outra função:
 *
 *  1. a reação da cliente virar BOLHA solta ("[reagiu 👍]") em vez de grudar
 *     na mensagem: era o comportamento antigo, e ninguém sabia a QUE ela
 *     reagiu;
 *  2. o eco da reação da PRÓPRIA LOJA entrar como se fosse da cliente (o
 *     WhatsApp devolve os dois pelo mesmo webhook — quem separa é o `fromMe`);
 *  3. gravar a mensagem e esquecer de tocar a CONVERSA: o sync de 3s só
 *     entrega conversa cujo `updatedAt` mudou, então a reação ficava no banco
 *     e invisível até um F5 (foi exatamente o bug de "editou e não atualizou");
 *  4. o campo não chegar à tela: as três consultas de mensagem passam pelo
 *     mesmo `MENSAGEM_LEVE` + `mapMessage`, e faltar num deles some com o
 *     emoji em um dos caminhos.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const webhook = ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts");
const engine = ler("src/lib/comm/engine.ts");
const inboxData = ler("src/lib/inbox-data.ts");
const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");

describe("a reação gruda na mensagem, não vira bolha", () => {
  it("o webhook intercepta o reactionMessage e NÃO segue para o fluxo de bolha", () => {
    expect(webhook).toContain("const rea = m.message?.reactionMessage;");
    // o `continue` é o que impede a reação de virar mensagem nova
    const trecho = webhook.slice(webhook.indexOf("const rea = m.message?.reactionMessage;"));
    expect(trecho.slice(0, 400)).toContain("continue;");
  });

  it("intercepta ANTES da leitura do corpo (senão já virou texto)", () => {
    expect(webhook.indexOf("const rea = m.message?.reactionMessage;")).toBeLessThan(
      webhook.indexOf("lerMensagemWA(m)")
    );
  });
});

describe("cada lado tem a sua reação", () => {
  it("o webhook separa pelo fromMe: loja em reactionStore, cliente em reaction", () => {
    expect(webhook).toContain(
      "data: daLoja ? { reactionStore: emoji || null } : { reaction: emoji || null },"
    );
    expect(webhook).toContain("m.key?.fromMe === true");
  });

  it("a loja reagindo pelo sistema grava no lado da loja", () => {
    expect(engine).toContain("data: { reactionStore: emoji || null },");
  });

  it("emoji vazio TIRA a reação (é assim que o WhatsApp desfaz)", () => {
    // `emoji || null` é o que transforma "" em "sem reação"
    expect(engine).toMatch(/reactionStore: emoji \|\| null/);
    expect(webhook).toMatch(/reactionStore: emoji \|\| null/);
    expect(webhook).toMatch(/reaction: emoji \|\| null/);
  });
});

describe("a reação aparece na tela sem precisar recarregar", () => {
  it("o webhook toca a CONVERSA depois de gravar a reação", () => {
    const trecho = webhook.slice(
      webhook.indexOf("async function aplicarReacao"),
      webhook.indexOf("async function aplicarReacao") + 1400
    );
    expect(trecho).toContain("db.conversation.updateMany");
    expect(trecho).toContain("updatedAt: new Date()");
  });

  it("o motor toca a CONVERSA depois de gravar a reação", () => {
    const trecho = engine.slice(
      engine.indexOf("export async function reagirNaMensagem"),
      engine.indexOf("export async function reagirNaMensagem") + 2600
    );
    expect(trecho).toContain("db.conversation.update");
    expect(trecho).toContain("updatedAt: new Date()");
  });
});

describe("achados da revisão (25/08/2026)", () => {
  const historico = ler("src/lib/comm/history-import.ts");

  it("mensagem que NÃO chegou ao WhatsApp não aceita reação", () => {
    // sem `externalId` o emoji não tem onde pousar lá; gravar aqui deixaria a
    // vendedora convencida de que a cliente viu um 👍 que nunca saiu
    expect(engine).toContain("if (noWhatsApp && !message.externalId)");
    expect(inbox).toContain('actionMsg.status !== "FALHOU"');
  });

  it("a importação de histórico não cria bolha de reação órfã", () => {
    expect(historico).toContain("reactionMessage");
    expect(historico).toMatch(/reactionMessage\b[\s\S]{0,60}\)\s*\n\s*continue;/);
  });

  it("a prévia da lista fica com a mensagem mais NOVA, não a última do lote", () => {
    // reação numa mensagem antiga traz aquela mensagem de volta no sync; sem
    // comparar a data, a linha da lista passava a mostrar um texto velho
    expect(inbox).toContain("doSync.createdAt >= daTela.createdAt");
  });

  it("a pastilha é confirmada com o que o servidor gravou", () => {
    expect(inbox).toContain("pintar(salvo.reactionStore ?? null)");
  });

  it("o visor avisa quando a foto não carrega (link do WhatsApp vence)", () => {
    expect(inbox).toContain("onError={() => setQuebrou(true)}");
  });
});

describe("o emoji chega até a bolha", () => {
  it("os dois campos entram no select único das mensagens", () => {
    const trecho = inboxData.slice(inboxData.indexOf("export const MENSAGEM_LEVE"));
    expect(trecho.slice(0, 800)).toContain("reaction: true,");
    expect(trecho.slice(0, 800)).toContain("reactionStore: true,");
  });

  it("o formato único (mapMessage) devolve os dois", () => {
    expect(inboxData).toContain("reaction: m.reaction ?? null,");
    expect(inboxData).toContain("reactionStore: m.reactionStore ?? null,");
  });

  it("a tela desenha a pastilha e oferece os emojis", () => {
    expect(inbox).toContain("const EMOJIS_REACAO");
    expect(inbox).toContain("/reacao");
    expect(inbox).toContain("m.reaction || m.reactionStore");
  });

  it("nota interna não pode ser reagida (não existe no WhatsApp da cliente)", () => {
    expect(engine).toContain('if (message.kind === "NOTE")');
    expect(inbox).toContain('actionMsg.kind !== "NOTE" &&');
    expect(inbox).toContain("!actionMsg.revoked &&");
  });
});
