// Guarda RN-028
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAX_TENTATIVAS_MIDIA,
  MEDIA_BASE64_MAX,
  MS_BUSCA_MIDIA,
  MS_ORCAMENTO_MIDIA_WEBHOOK,
  MS_ORCAMENTO_REPESCA,
  buscarArquivo,
  mimeEsperado,
  proximaTentativa,
} from "../midia-pendente";

/**
 * RN-028 · O ARQUIVO DA CLIENTE NÃO SE PERDE.
 *
 * A premissa do produto é curta: se a cliente mandou, tem que chegar. Duas
 * coisas quebravam isso, e as duas estão guardadas aqui.
 *
 *  1. O TEMPO. O download de um arquivo podia durar mais do que a função
 *     inteira do webhook — e quando a Vercel matava a execução, as mensagens
 *     do lote que ainda não tinham sido gravadas sumiam sem deixar rastro.
 *  2. A DESISTÊNCIA. Falhou uma vez, acabou: ninguém tentava de novo e
 *     ninguém ficava sabendo.
 */

const ler = (p: string) => readFileSync(p, "utf8");
const WEBHOOK = "src/app/api/whatsapp/evolution/webhook/[token]/route.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("o tempo do download cabe no tempo da função", () => {
  /**
   * ESTE É O TESTE DO INCIDENTE.
   *
   * O webhook tinha 30s de vida e cada download podia levar 45s. Não é uma
   * questão de estilo: com essa conta, um único arquivo lento matava a
   * execução e levava junto todas as mensagens ainda não gravadas do lote.
   * Se algum dia alguém encurtar a função ou esticar o download, aqui quebra.
   */
  it("um download nunca pode durar mais que a função do webhook", () => {
    const fonte = ler(WEBHOOK);
    const segundos = Number(fonte.match(/export const maxDuration = (\d+)/)![1]);
    expect(segundos).toBeGreaterThan(0);
    expect(MS_BUSCA_MIDIA).toBeLessThan(segundos * 1000);
  });

  it("o orçamento de arquivos deixa folga para gravar as mensagens", () => {
    const fonte = ler(WEBHOOK);
    const segundos = Number(fonte.match(/export const maxDuration = (\d+)/)![1]);
    // gravar a conversa é o que nunca pode faltar: o arquivo fica com uma
    // fatia do tempo, nunca com o tempo todo
    expect(MS_ORCAMENTO_MIDIA_WEBHOOK).toBeLessThan(segundos * 1000 * 0.6);
    // e o orçamento tem que caber pelo menos um download inteiro, senão
    // nenhum arquivo chegaria na hora e tudo dependeria da repesca
    expect(MS_ORCAMENTO_MIDIA_WEBHOOK).toBeGreaterThanOrEqual(MS_BUSCA_MIDIA);
  });

  it("o webhook só começa um download que CABE no que sobrou do orçamento", () => {
    // Medido no teste de ponta a ponta contra o Postgres: com a checagem
    // ingênua ("ainda estou dentro do orçamento"), quatro arquivos travados
    // levavam o webhook a 36s — porque o download que começa no último
    // segundo ainda roda inteiro por cima. A conta tem que somar o download.
    const fonte = ler(WEBHOOK);
    expect(fonte).toMatch(/inicioDoLote \+ MS_BUSCA_MIDIA <= MS_ORCAMENTO_MIDIA_WEBHOOK/);
  });
});

describe("quando tentar de novo", () => {
  const agora = new Date("2026-08-31T12:00:00Z");

  it("a primeira falha volta a tentar em minutos, não em horas", () => {
    const proxima = proximaTentativa(1, agora)!;
    const minutos = (proxima.getTime() - agora.getTime()) / 60_000;
    // o motivo mais comum é o servidor ainda estar processando o arquivo
    expect(minutos).toBeLessThanOrEqual(5);
  });

  it("cada tentativa espera mais que a anterior", () => {
    let anterior = 0;
    for (let t = 1; t <= MAX_TENTATIVAS_MIDIA; t++) {
      const espera = proximaTentativa(t, agora)!.getTime() - agora.getTime();
      expect(espera).toBeGreaterThan(anterior);
      anterior = espera;
    }
  });

  it("insiste por horas antes de desistir (o servidor não guarda para sempre)", () => {
    const ultima = proximaTentativa(MAX_TENTATIVAS_MIDIA, agora)!;
    const horas = (ultima.getTime() - agora.getTime()) / 3_600_000;
    expect(horas).toBeGreaterThanOrEqual(1);
  });

  it("esgotadas as tentativas, para de tentar (não fica batendo para sempre)", () => {
    expect(proximaTentativa(MAX_TENTATIVAS_MIDIA + 1, agora)).toBeNull();
  });
});

describe("buscando o arquivo no servidor de conexão", () => {
  const respondendo = (status: number, corpo: unknown) =>
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
    })) as unknown as typeof fetch;

  const ligado = () => {
    vi.stubEnv("EVOLUTION_URL", "https://evo.exemplo");
    vi.stubEnv("EVOLUTION_KEY", "chave");
  };

  it("arquivo que veio vira data-URL com o tipo certo", async () => {
    ligado();
    vi.stubGlobal(
      "fetch",
      respondendo(200, { base64: "QUJD", mimetype: "application/pdf" })
    );
    const r = await buscarArquivo("inst", "wamid.1");
    expect(r.ok).toBe(true);
    expect(r.ok && r.dataUrl).toBe("data:application/pdf;base64,QUJD");
  });

  it("servidor ocupado NÃO é desistir — o arquivo volta para a fila", async () => {
    ligado();
    vi.stubGlobal("fetch", respondendo(500, {}));
    const r = await buscarArquivo("inst", "wamid.1");
    expect(r.ok).toBe(false);
    // `desistir: false` é o que faz a repesca tentar de novo mais tarde
    expect(!r.ok && r.desistir).toBe(false);
  });

  it("resposta vazia também volta para a fila", async () => {
    ligado();
    vi.stubGlobal("fetch", respondendo(200, { base64: "" }));
    const r = await buscarArquivo("inst", "wamid.1");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.desistir).toBe(false);
  });

  it("arquivo grande demais desiste na hora, e o motivo fala humano", async () => {
    ligado();
    const gigante = "A".repeat(MEDIA_BASE64_MAX + 10);
    vi.stubGlobal("fetch", respondendo(200, { base64: gigante, mimetype: "video/mp4" }));
    const r = await buscarArquivo("inst", "wamid.1");
    expect(r.ok).toBe(false);
    // insistir num arquivo que não cabe seria bater na mesma porta para sempre
    expect(!r.ok && r.desistir).toBe(true);
    // e a vendedora precisa entender o que houve, sem código nenhum
    expect(!r.ok && r.motivo).toMatch(/grande demais/i);
    expect(!r.ok && r.motivo).toMatch(/WhatsApp/);
  });

  it("sem tipo declarado, o arquivo entra assim mesmo (nunca some)", async () => {
    ligado();
    vi.stubGlobal("fetch", respondendo(200, { base64: "QUJD" }));
    const r = await buscarArquivo("inst", "wamid.1");
    expect(r.ok).toBe(true);
    expect(r.ok && r.dataUrl.startsWith("data:application/octet-stream;")).toBe(true);
  });
});

describe("a ordem no webhook: mensagem primeiro, arquivo depois", () => {
  /**
   * O comportamento que estas linhas defendem é "a bolha existe mesmo que o
   * arquivo não chegue". Ele nasce da ORDEM das operações no webhook, e a
   * ordem não dá para observar de fora sem um banco: por isso aqui se
   * confere que a gravação não depende mais do download.
   */
  const fonte = ler(WEBHOOK);

  it("a mensagem da cliente entra marcada como 'arquivo pendente'", () => {
    expect(fonte).toMatch(/mediaPending: true/);
  });

  it("o webhook não guarda mais o arquivo antes de gravar a mensagem", () => {
    // a função que baixava ANTES de gravar não existe mais
    expect(fonte).not.toMatch(/fetchMediaDataUrl/);
  });

  it("o lote tem orçamento de tempo para arquivos", () => {
    expect(fonte).toMatch(/temTempoParaArquivo/);
  });
});

/**
 * ACHADOS DA REVISÃO (31/08/2026) — casos de canto que o caminho feliz não
 * mostra, e que já custariam anexo perdido em produção.
 */
describe("o que a revisão pegou", () => {
  it("a repesca sabe o tipo esperado do arquivo", () => {
    // sem este palpite, foto repescada virava `application/octet-stream` — e a
    // rota de mídia serve isso como DOWNLOAD, deixando a bolha quebrada
    expect(mimeEsperado("IMAGE")).toBe("image/jpeg");
    expect(mimeEsperado("AUDIO")).toBe("audio/ogg");
    expect(mimeEsperado("VIDEO")).toBe("video/mp4");
    // documento não se chuta: o tipo real é o do arquivo
    expect(mimeEsperado("DOCUMENT")).toBeNull();
    expect(mimeEsperado(null)).toBeNull();
  });

  it("loja sem conexão NÃO é motivo para desistir do arquivo", () => {
    const fonte = readFileSync("src/lib/comm/midia-pendente.ts", "utf8");
    // reconectar o WhatsApp zera a instância por alguns minutos; tratar isso
    // como definitivo matava TODOS os pendentes de uma vez, sem gastar
    // tentativa nenhuma — o buraco que esta regra existe para fechar
    expect(fonte).toContain("sem conexão de WhatsApp no momento");
    expect(fonte).not.toContain(
      'if (!msg.instance || !msg.externalId) {'
    );
  });

  it("a rodada de repesca também tem orçamento de tempo", () => {
    // a rodada roda dentro da vida da função da inbox; cortada no meio,
    // perderia o minuto inteiro (a trava é tomada antes do trabalho)
    expect(MS_ORCAMENTO_REPESCA).toBeGreaterThanOrEqual(MS_BUSCA_MIDIA);
    const rota = readFileSync("src/app/api/conversations/route.ts", "utf8");
    const teto = Number(rota.match(/export const maxDuration = (\d+)/)?.[1]);
    expect(teto).toBeGreaterThan(0);
    expect(MS_ORCAMENTO_REPESCA).toBeLessThanOrEqual(teto * 1000);
  });

  it("desistir de um anexo não gasta a trava do alarme de produção", () => {
    const fonte = readFileSync("src/lib/comm/midia-pendente.ts", "utf8");
    // a trava do push "🚨 Erro em produção" é de 15 min e é escassa: um anexo
    // vencido silenciaria uma falha grave de verdade na mesma janela
    // a menção no comentário explicando POR QUE não usamos pode ficar;
    // o que não pode voltar é a CHAMADA
    expect(fonte).not.toMatch(/await logServerError\(/);
    // o registro certo é o da loja, na Central de Comunicação
    expect(fonte).toContain("midia.nao-chegou");
  });

  it("a recusa na porta da Meta tem freio (quem bate ali não tem senha)", () => {
    const rota = readFileSync("src/app/api/whatsapp/webhook/route.ts", "utf8");
    expect(rota).toContain("MS_ENTRE_AVISOS_DE_RECUSA");
    expect(rota).toContain("jaAvisado");
  });
});
