import { describe, expect, it } from "vitest";
import { jidToPhone, splitDataUrl, TERMO_WA_SHA, TERMO_WA_TEXTO } from "../evolution";

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
