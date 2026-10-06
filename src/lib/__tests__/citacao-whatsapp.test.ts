import { describe, it, expect, vi, beforeEach } from "vitest";
import { citacaoWA, corpoDaCitada } from "../comm/wa-message";
import { mapMessage } from "../inbox-data";

const findFirst = vi.fn();
vi.mock("../db", () => ({
  db: { message: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
import { idDaMensagemCitada } from "../comm/engine";

/**
 * A MENSAGEM CITADA APARECE NA CENTRAL (pedido do dono, 06/10/2026): a
 * cliente responde "2 m e 2g" em cima de cada foto; no aplicativo cada
 * resposta mostra a foto, na Central as bolhas chegavam soltas. A Central
 * mandava citação e não lia a que chegava.
 */
describe("citacaoWA: lê qual mensagem a cliente está respondendo", () => {
  it("texto respondendo uma foto: o stanzaId do contextInfo", () => {
    const m = {
      message: {
        extendedTextMessage: {
          text: "2 m e 2g",
          contextInfo: { stanzaId: "3EB0ABCDEF", participant: "5565999@s.whatsapp.net" },
        },
      },
    };
    expect(citacaoWA(m)).toBe("3EB0ABCDEF");
  });

  it("foto respondendo uma mensagem (contextInfo dentro do imageMessage)", () => {
    expect(
      citacaoWA({ message: { imageMessage: { caption: "essa?", contextInfo: { stanzaId: "X1" } } } })
    ).toBe("X1");
  });

  it("embrulhada em mensagem temporária: desembrulha antes de procurar", () => {
    const m = {
      message: {
        ephemeralMessage: {
          message: { extendedTextMessage: { text: "ok", contextInfo: { stanzaId: "EPH1" } } },
        },
      },
    };
    expect(citacaoWA(m)).toBe("EPH1");
  });

  it("mensagem comum (sem citação) devolve null — a bolha nasce solta, como sempre", () => {
    expect(citacaoWA({ message: { conversation: "oi" } })).toBeNull();
    // contextInfo de anúncio não é citação
    expect(
      citacaoWA({
        message: { extendedTextMessage: { text: "oi", contextInfo: { externalAdReply: { title: "x" } } } },
      })
    ).toBeNull();
    expect(citacaoWA(undefined)).toBeNull();
    expect(citacaoWA({ message: { extendedTextMessage: { text: "oi", contextInfo: { stanzaId: 12 } } } })).toBeNull();
  });
});

describe("a caixinha da citada recebe o que precisa para desenhar como o aplicativo", () => {
  const base = {
    id: "m1",
    direction: "IN",
    kind: "TEXT",
    mediaType: "TEXT",
    temMidia: false,
    fileName: null,
    status: "RECEBIDA",
    error: null,
    body: "2 m e 2g",
    createdAt: new Date("2026-10-06T15:44:00Z"),
    deliveredAt: null,
    readAt: null,
    editedAt: null,
    revoked: false,
    revokedBy: null,
  };

  it("citada que é FOTO leva a miniatura (link da mídia dela) e a data para pular até ela", () => {
    const quando = new Date("2026-10-06T15:40:00Z");
    const r = mapMessage({
      ...base,
      replyTo: { id: "foto1", body: "[foto]", direction: "OUT", mediaType: "IMAGE", createdAt: quando },
    });
    expect(r.replyTo).toEqual({
      id: "foto1",
      body: "[foto]",
      direction: "OUT",
      mediaType: "IMAGE",
      mediaUrl: "/api/messages/foto1/media",
      createdAt: quando.toISOString(),
    });
  });

  it("citada de texto não tem miniatura", () => {
    const r = mapMessage({
      ...base,
      replyTo: { id: "t1", body: "Quanto vai ficar?", direction: "IN", mediaType: "TEXT", createdAt: new Date() },
    });
    expect(r.replyTo?.mediaUrl).toBeNull();
    expect(r.replyTo?.mediaType).toBe("TEXT");
  });

  it("sem citação continua null", () => {
    expect(mapMessage({ ...base, replyTo: null }).replyTo).toBeNull();
  });
});

describe("corpoDaCitada: o texto da caixinha, como no aplicativo", () => {
  it("marcador sem legenda vira rótulo com ícone", () => {
    expect(corpoDaCitada("[foto]")).toBe("📷 Foto");
    expect(corpoDaCitada("[áudio]")).toBe("🎙️ Áudio");
    expect(corpoDaCitada("[figurinha]")).toBe("🖼️ Figurinha");
  });
  it("arquivo mostra o NOME (é o que diz qual é)", () => {
    expect(corpoDaCitada("[arquivo] tabela-precos-outono.pdf")).toBe("📄 tabela-precos-outono.pdf");
    expect(corpoDaCitada("[arquivo]")).toBe("📄 Arquivo");
  });
  it("legenda e texto comum passam como estão", () => {
    expect(corpoDaCitada("[foto] olha essa")).toBe("[foto] olha essa");
    expect(corpoDaCitada("2 m e 2g")).toBe("2 m e 2g");
  });
});

describe("idDaMensagemCitada: a citada é procurada na LOJA e na CONVERSA, e nunca lança", () => {
  beforeEach(() => findFirst.mockReset());

  it("acha a nossa mensagem pelo id do WhatsApp, recortada pela conversa (a régua do envio)", async () => {
    findFirst.mockResolvedValueOnce({ id: "m-foto" });
    await expect(idDaMensagemCitada("loja1", "conv1", "FOTO1")).resolves.toBe("m-foto");
    expect(findFirst).toHaveBeenCalledWith({
      where: { externalId: "FOTO1", conversationId: "conv1", conversation: { companyId: "loja1" } },
      select: { id: true },
    });
  });

  it("sem citação não vai ao banco; citada que não temos devolve null (bolha solta, como sempre)", async () => {
    await expect(idDaMensagemCitada("loja1", "conv1", null)).resolves.toBeNull();
    await expect(idDaMensagemCitada("loja1", "conv1", undefined)).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    findFirst.mockResolvedValueOnce(null);
    await expect(idDaMensagemCitada("loja1", "conv1", "SUMIU")).resolves.toBeNull();
  });

  it("erro do banco vira null — a mensagem da cliente ainda ganha o id do WhatsApp (sem ele a reentrega duplicava)", async () => {
    findFirst.mockRejectedValueOnce(new Error("timeout"));
    await expect(idDaMensagemCitada("loja1", "conv1", "X")).resolves.toBeNull();
  });
});
