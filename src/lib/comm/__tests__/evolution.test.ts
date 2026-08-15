import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { jidToPhone, splitDataUrl, TERMO_WA_SHA, TERMO_WA_TEXTO, evoSendText, jidDeNumero } from "../evolution";

// Guarda RN-017 (índice em docs/regras.md; texto no CLAUDE.md).

describe("splitDataUrl", () => {
  it("separa mime e base64 de uma data URL simples", () => {
    expect(splitDataUrl("data:image/jpeg;base64,AAAA")).toEqual({
      mimetype: "image/jpeg",
      base64: "AAAA",
    });
  });
  it("tolera mime com parâmetros (áudio do navegador tem ;codecs=)", () => {
    expect(splitDataUrl("data:audio/webm;codecs=opus;base64,BBBB")).toEqual({
      mimetype: "audio/webm",
      base64: "BBBB",
    });
  });
  it("devolve null para links http (não é data URL)", () => {
    expect(splitDataUrl("https://exemplo.com/a.mp3")).toBeNull();
  });
});

describe("jidToPhone", () => {
  it("extrai o telefone de um JID de contato", () => {
    expect(jidToPhone("5511999998888@s.whatsapp.net")).toBe("5511999998888");
  });
  it("ignora grupos e listas", () => {
    expect(jidToPhone("120363123456789012@g.us")).toBeNull();
    expect(jidToPhone("status@broadcast")).toBeNull();
  });
  it("ignora lixo", () => {
    expect(jidToPhone("")).toBeNull();
    expect(jidToPhone("abc@s.whatsapp.net")).toBeNull();
  });
});

describe("termo de aceite", () => {
  it("cobre os pontos críticos de proteção", () => {
    expect(TERMO_WA_TEXTO).toContain("SEM AVISO PRÉVIO");
    expect(TERMO_WA_TEXTO).toContain("número DEDICADO");
    expect(TERMO_WA_TEXTO).toContain("API oficial");
  });
  it("hash da versão é estável e curto", () => {
    expect(TERMO_WA_SHA).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("citação da resposta (quoted)", () => {
  const original = { url: process.env.EVOLUTION_URL, key: process.env.EVOLUTION_KEY };
  const capturarCorpo = () => {
    const capturado: { body?: Record<string, unknown> } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body?: string }) => {
        capturado.body = JSON.parse(init.body ?? "{}");
        return new Response(JSON.stringify({ key: { id: "X" } }), { status: 200 });
      })
    );
    return capturado;
  };

  beforeEach(() => {
    process.env.EVOLUTION_URL = "https://evo.teste";
    process.env.EVOLUTION_KEY = "chave";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.EVOLUTION_URL = original.url;
    process.env.EVOLUTION_KEY = original.key;
  });

  it("mensagem simples não leva citação nenhuma", async () => {
    const cap = capturarCorpo();
    await evoSendText("loja", "5511999998888", "oi");
    expect(cap.body).toEqual({ number: "5511999998888", text: "oi" });
  });

  it("resposta leva a citação COMPLETA: de quem é e o conteúdo", async () => {
    const cap = capturarCorpo();
    await evoSendText("loja", "5511999998888", "chegou sim", {
      id: "ABC123",
      remoteJid: jidDeNumero("5511999998888"),
      fromMe: false,
      texto: "meu pedido chegou?",
    });
    // citação sem autor (só o id) é o que fazia a mensagem encalhar no
    // celular da loja como "Aguardando mensagem"
    expect(cap.body?.quoted).toEqual({
      key: { remoteJid: "5511999998888@s.whatsapp.net", fromMe: false, id: "ABC123" },
      message: { conversation: "meu pedido chegou?" },
    });
  });

  it("citando mensagem da própria loja, fromMe vai true", async () => {
    const cap = capturarCorpo();
    await evoSendText("loja", "5511999998888", "seguinte", {
      id: "DEF456",
      remoteJid: jidDeNumero("5511999998888"),
      fromMe: true,
      texto: "seu pedido saiu para entrega",
    });
    expect((cap.body?.quoted as { key: { fromMe: boolean } }).key.fromMe).toBe(true);
  });

  it("citando mídia sem legenda, manda a chave sem corpo vazio", async () => {
    const cap = capturarCorpo();
    await evoSendText("loja", "5511999998888", "é essa", {
      id: "GHI789",
      remoteJid: jidDeNumero("5511999998888"),
      fromMe: false,
      texto: "   ",
    });
    expect(cap.body?.quoted).toEqual({
      key: { remoteJid: "5511999998888@s.whatsapp.net", fromMe: false, id: "GHI789" },
    });
  });
});

describe("jidDeNumero", () => {
  it("limpa a formatação do telefone", () => {
    expect(jidDeNumero("+55 (11) 99999-8888")).toBe("5511999998888@s.whatsapp.net");
  });
});
