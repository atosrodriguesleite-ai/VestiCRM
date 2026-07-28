import { describe, expect, it } from "vitest";
import { lerMensagemWA, desembrulhar } from "../wa-message";

/**
 * A regra que estes testes travam: NENHUMA MENSAGEM PODE SUMIR.
 *
 * Antes, o que o sistema não soubesse ler virava texto vazio e era descartado
 * em silêncio no webhook. A loja não ficava sabendo que a cliente falou.
 */

describe("texto e mídia (o dia a dia)", () => {
  it("texto simples", () => {
    expect(lerMensagemWA({ message: { conversation: "oi, tem no tamanho M?" } }).text).toBe(
      "oi, tem no tamanho M?"
    );
  });

  it("texto com formatação/citação (extendedTextMessage)", () => {
    expect(lerMensagemWA({ message: { extendedTextMessage: { text: "e o frete?" } } }).text).toBe(
      "e o frete?"
    );
  });

  it("foto com e sem legenda", () => {
    expect(lerMensagemWA({ message: { imageMessage: { caption: "essa aqui" } } })).toMatchObject({
      text: "essa aqui",
      mediaType: "IMAGE",
    });
    expect(lerMensagemWA({ message: { imageMessage: {} } }).text).toBe("[foto]");
  });

  it("vídeo redondo (ptv) conta como vídeo", () => {
    expect(lerMensagemWA({ message: { ptvMessage: {} } }).mediaType).toBe("VIDEO");
  });

  it("áudio e arquivo", () => {
    expect(lerMensagemWA({ message: { audioMessage: {} } }).mediaType).toBe("AUDIO");
    const arq = lerMensagemWA({ message: { documentMessage: { fileName: "tabela.pdf" } } });
    expect(arq.mediaType).toBe("DOCUMENT");
    expect(arq.fileName).toBe("tabela.pdf");
    expect(arq.text).toContain("tabela.pdf");
  });
});

describe("embrulhos — o caso que fazia a conversa inteira sumir", () => {
  it("mensagem TEMPORÁRIA é desembrulhada", () => {
    // com "mensagens temporárias" ligada, TODA mensagem chega assim
    expect(
      lerMensagemWA({
        message: { ephemeralMessage: { message: { conversation: "vou querer 3 peças" } } },
      }).text
    ).toBe("vou querer 3 peças");
  });

  it("visualização única é desembrulhada (todas as versões)", () => {
    for (const chave of ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"]) {
      const r = lerMensagemWA({ message: { [chave]: { message: { imageMessage: {} } } } });
      expect(r.mediaType, chave).toBe("IMAGE");
    }
  });

  it("arquivo com legenda é desembrulhado", () => {
    const r = lerMensagemWA({
      message: {
        documentWithCaptionMessage: {
          message: { documentMessage: { fileName: "pedido.pdf" } },
        },
      },
    });
    expect(r.mediaType).toBe("DOCUMENT");
    expect(r.fileName).toBe("pedido.pdf");
  });

  it("embrulho dentro de embrulho também abre", () => {
    expect(
      lerMensagemWA({
        message: {
          ephemeralMessage: {
            message: { viewOnceMessageV2: { message: { conversation: "some depois" } } },
          },
        },
      }).text
    ).toBe("some depois");
  });

  it("desembrulhar não entra em laço infinito", () => {
    const laco: Record<string, unknown> = {};
    laco.ephemeralMessage = { message: laco };
    expect(() => desembrulhar(laco)).not.toThrow();
  });
});

describe("formatos que antes eram jogados fora", () => {
  it("localização vira link do mapa", () => {
    const r = lerMensagemWA({
      message: {
        locationMessage: { degreesLatitude: -23.55, degreesLongitude: -46.63, name: "Loja Centro" },
      },
    });
    expect(r.text).toContain("[localização]");
    expect(r.text).toContain("Loja Centro");
    expect(r.text).toContain("maps.google.com/?q=-23.55,-46.63");
  });

  it("localização em tempo real é identificada", () => {
    expect(
      lerMensagemWA({ message: { liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } } })
        .text
    ).toContain("tempo real");
  });

  it("contato compartilhado traz nome e telefone", () => {
    const r = lerMensagemWA({
      message: {
        contactMessage: {
          displayName: "Marcia Tecidos",
          vcard: "BEGIN:VCARD\nTEL;type=CELL:+55 11 98888-7777\nEND:VCARD",
        },
      },
    });
    expect(r.text).toContain("Marcia Tecidos");
    expect(r.text).toContain("98888-7777");
  });

  it("vários contatos de uma vez", () => {
    expect(
      lerMensagemWA({ message: { contactsArrayMessage: { contacts: [{}, {}, {}] } } }).text
    ).toBe("[3 contatos compartilhados]");
  });

  it("enquete mostra a pergunta e as opções", () => {
    const r = lerMensagemWA({
      message: {
        pollCreationMessage: {
          name: "Qual cor?",
          options: [{ optionName: "Preto" }, { optionName: "Bege" }],
        },
      },
    });
    expect(r.text).toBe("[enquete] Qual cor?: Preto · Bege");
  });

  it("reação com e sem emoji", () => {
    expect(lerMensagemWA({ message: { reactionMessage: { text: "👍" } } }).text).toBe("[reagiu 👍]");
    expect(lerMensagemWA({ message: { reactionMessage: { text: "" } } }).text).toBe(
      "[removeu a reação]"
    );
  });

  it("resposta de botão e de lista viram o texto escolhido", () => {
    expect(
      lerMensagemWA({ message: { buttonsResponseMessage: { selectedDisplayText: "Quero sim" } } })
        .text
    ).toBe("Quero sim");
    expect(
      lerMensagemWA({ message: { listResponseMessage: { title: "Camisetas" } } }).text
    ).toBe("Camisetas");
  });
});

describe("o que ninguém previu ainda", () => {
  it("tipo desconhecido NÃO some: vira aviso com o nome do tipo", () => {
    const r = lerMensagemWA({ message: { algumFormatoNovoDoWhatsapp: { x: 1 } } });
    expect(r.text).not.toBe("");
    expect(r.text).toContain("abra o WhatsApp");
    expect(r.text).toContain("algumFormatoNovoDoWhatsapp");
    expect(r.desconhecida).toBe(true);
  });

  it("mensagem sem conteúdo nenhum é marcada como desconhecida", () => {
    expect(lerMensagemWA({ message: {} }).desconhecida).toBe(true);
    expect(lerMensagemWA(undefined).desconhecida).toBe(true);
  });

  it("campos internos do protocolo não viram bolha de aviso", () => {
    // messageContextInfo vem junto de muita coisa e não é conteúdo
    const r = lerMensagemWA({
      message: { messageContextInfo: { x: 1 }, conversation: "oi" },
    });
    expect(r.text).toBe("oi");
  });
});
