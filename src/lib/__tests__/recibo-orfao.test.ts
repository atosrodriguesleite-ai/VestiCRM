import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reciboMaisForte, reciboAvanca } from "../comm/recibo";

/**
 * A CORRIDA DO RECIBO (incidente real, 28/08/2026 — print do dono):
 * mensagem mandada PELO CELULAR só vira bolha depois que o webhook baixa a
 * mídia (segundos). Com a cliente ONLINE, o "entregue" chega ANTES de a
 * bolha existir, era descartado em silêncio e a mensagem ficava no ✓ para
 * sempre — no aplicativo constava entregue, no sistema não. Cliente com
 * confirmação de leitura desligada nunca manda outro recibo que conserte.
 *
 * A cura: recibo órfão fica ANOTADO (recibo.orfao) e é REAPLICADO em todo
 * lugar que grava um externalId novo.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const engine = ler("src/lib/comm/engine.ts");
const webhook = ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts");

describe("desempate de recibos (regra pura)", () => {
  it("LIDA vence ENTREGUE (visto implica entregue)", () => {
    expect(reciboMaisForte(["ENTREGUE", "LIDA"])).toBe("LIDA");
  });
  it("ENTREGUE vence FALHOU (a mensagem chegou — falha anterior era alarme falso)", () => {
    expect(reciboMaisForte(["FALHOU", "ENTREGUE"])).toBe("ENTREGUE");
  });
  it("só FALHOU continua FALHOU; lista vazia não inventa recibo", () => {
    expect(reciboMaisForte(["FALHOU"])).toBe("FALHOU");
    expect(reciboMaisForte([])).toBe(null);
  });
});

describe("o status da bolha só anda PARA FRENTE (reciboAvanca)", () => {
  it("recibo atrasado não rebaixa: LIDA fica LIDA, ENTREGUE não vira FALHOU", () => {
    expect(reciboAvanca("LIDA", "ENTREGUE")).toBe(false);
    expect(reciboAvanca("ENTREGUE", "FALHOU")).toBe(false);
    expect(reciboAvanca("LIDA", "LIDA")).toBe(false);
  });
  it("informação nova avança: ENVIADA vira FALHOU, FALHOU vira ENTREGUE", () => {
    expect(reciboAvanca("ENVIADA", "FALHOU")).toBe(true);
    expect(reciboAvanca("FALHOU", "ENTREGUE")).toBe(true);
    expect(reciboAvanca("ENVIANDO", "ENTREGUE")).toBe(true);
    expect(reciboAvanca("ENTREGUE", "LIDA")).toBe(true);
  });
  it("o motor aplica a régua no recibo E na reaplicação", () => {
    expect(engine).toContain("const avanca = reciboAvanca(message.status, status);");
  });
  it("o envio pelo painel também não regride (só ENVIANDO/FALHOU viram ENVIADA)", () => {
    // a adoção do eco ou um recibo ao vivo podem já ter levado a ✓✓ — o
    // "sucesso" do provedor chegando depois não pode voltar para ✓
    expect(engine).toContain('where: { id: messageId, status: { in: ["ENVIANDO", "FALHOU"] } }');
  });
});

describe("o recibo que chega cedo demais não é mais jogado fora", () => {
  it("recibo sem mensagem vira recibo.orfao (status OK — sem bolinha vermelha)", () => {
    expect(engine).toContain('type: "recibo.orfao"');
    expect(engine).toContain("payload: { externalId, status }");
  });
  it("só quem tem reaplicador anota o órfão (Cloud API/simulador não acumulam lixo)", () => {
    expect(engine).toContain("if (!opts?.anotarOrfao) return null;");
    expect(webhook).toContain("{ anotarOrfao: true }");
  });
  it("depois de anotar, confere DE NOVO se a bolha nasceu (fecha a fresta de ms)", () => {
    // cada lado escreve e depois olha o outro: um dos dois sempre vê o recibo
    const anota = engine.indexOf('type: "recibo.orfao"');
    expect(anota).toBeGreaterThan(-1);
    expect(engine.slice(anota, anota + 900)).toContain("message = await db.message.findFirst({");
  });
  it("a reaplicação existe, com janela e desempate", () => {
    expect(engine).toContain("export async function aplicarRecibosOrfaos");
    expect(engine).toContain("RECIBO_ORFAO_JANELA_MS");
    expect(engine).toContain("reciboMaisForte(statuses)");
    // `contains` no JSON pode casar por acaso — o id é conferido de verdade
    expect(engine).toContain("p.externalId === externalId");
  });
});

describe("todo lugar que grava externalId reaplica o órfão", () => {
  it("eco do celular: depois de CRIAR a bolha", () => {
    // o ponto exato da corrida do incidente
    const criacao = webhook.indexOf("A CORRIDA DO RECIBO");
    expect(criacao).toBeGreaterThan(-1);
    expect(webhook.slice(criacao, criacao + 700)).toContain(
      "aplicarRecibosOrfaos(companyId, m.key.id)"
    );
  });
  it("eco do celular: depois de ADOTAR a pendente (envio do painel que estourou o tempo)", () => {
    const adocao = webhook.indexOf("antes de a pendente ganhar");
    expect(adocao).toBeGreaterThan(-1);
    expect(webhook.slice(adocao, adocao + 300)).toContain("aplicarRecibosOrfaos");
  });
  it("envio pelo painel: depois de o provedor devolver o externalId", () => {
    expect(engine).toContain("aplicarRecibosOrfaos(input.companyId, result.externalId)");
  });
});

describe("o recibo é lido de qualquer formato do servidor", () => {
  it("id em `keyId` OU em `key.id` (mesma lição da edição de 17/08)", () => {
    expect(webhook).toContain("const alvoDoRecibo = u?.keyId ?? u?.key?.id;");
  });
  it("recibo de grupo/status nem tenta (nunca casa e não vira órfão)", () => {
    expect(webhook).toContain('jidDoRecibo.endsWith("@g.us")');
    expect(webhook).toContain('jidDoRecibo.startsWith("status@")');
  });
});
