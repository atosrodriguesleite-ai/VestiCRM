import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerEdicao } from "../edicao";

/**
 * MENSAGEM EDITADA — incidente Toque Leve, 31/07/2026.
 *
 * A cliente mandou "Regata nadador branca / 1 M 1 G", editou logo depois
 * acrescentando "1 M vinho", e o sistema continuou mostrando a versão VELHA.
 * A loja ia separar o pedido FALTANDO UMA PEÇA, sem desconfiar. E no lugar da
 * correção apareceu uma bolha "[mensagem não exibida aqui]".
 *
 * Duas causas: a edição chega em vários formatos (a gente lia só um), e o id
 * da mensagem a corrigir vem DENTRO do aviso — usar o id do próprio aviso,
 * que é novo, nunca acha o alvo.
 */

const NOVO = "Regata nadador branca\n1 M 1 G\n1 M vinho";

describe("formato 1: protocolMessage MESSAGE_EDIT (o mais comum)", () => {
  it("pega o texto novo E o id da mensagem original", () => {
    expect(
      lerEdicao({
        key: { id: "AVISO-NOVO" },
        message: {
          protocolMessage: {
            key: { id: "MSG-ORIGINAL" },
            type: "MESSAGE_EDIT",
            editedMessage: { conversation: NOVO },
          },
        },
      })
    ).toEqual({ alvoId: "MSG-ORIGINAL", texto: NOVO });
  });

  it("o tipo também chega como número (14)", () => {
    const e = lerEdicao({
      key: { id: "A" },
      message: {
        protocolMessage: {
          key: { id: "ORIG" },
          type: 14,
          editedMessage: { extendedTextMessage: { text: NOVO } },
        },
      },
    });
    expect(e).toEqual({ alvoId: "ORIG", texto: NOVO });
  });

  it("NÃO confunde com apagar (REVOKE não é edição)", () => {
    expect(
      lerEdicao({
        key: { id: "A" },
        message: { protocolMessage: { key: { id: "ORIG" }, type: "REVOKE" } },
      })
    ).toBeNull();
  });
});

describe("formato 2: editedMessage embrulhando protocolMessage", () => {
  it("acha o texto e o alvo lá dentro", () => {
    expect(
      lerEdicao({
        key: { id: "AVISO" },
        message: {
          editedMessage: {
            message: {
              protocolMessage: {
                key: { id: "ORIG" },
                type: "MESSAGE_EDIT",
                editedMessage: { conversation: NOVO },
              },
            },
          },
        },
      })
    ).toEqual({ alvoId: "ORIG", texto: NOVO });
  });
});

describe("formato 3: editedMessage com o texto direto (o que já líamos)", () => {
  it("continua funcionando — nada foi quebrado", () => {
    expect(
      lerEdicao({
        key: { id: "ORIG" },
        message: { editedMessage: { message: { conversation: NOVO } } },
      })
    ).toEqual({ alvoId: "ORIG", texto: NOVO });
  });
});

describe("formato 4: edição criptografada (secretEncryptedMessage)", () => {
  /**
   * Foi o que apareceu no print da Toque Leve. O texto novo vem cifrado e não
   * dá para ler. Mas dá para saber QUAL mensagem mudou — então o sistema diz
   * a verdade: marca a mensagem como editada, para a loja conferir no
   * WhatsApp, em vez de deixar uma bolha enigmática solta na conversa.
   */
  it("sem texto, mas com o alvo — vira “editada”", () => {
    expect(
      lerEdicao({
        key: { id: "AVISO" },
        message: {
          secretEncryptedMessage: {
            targetMessageKey: { id: "ORIG" },
            encPayload: "…",
          },
        },
      })
    ).toEqual({ alvoId: "ORIG", texto: "" });
  });

  it("sem saber o alvo NÃO é edição: vira bolha (nada se perde)", () => {
    expect(
      lerEdicao({ key: { id: "A" }, message: { secretEncryptedMessage: { encPayload: "…" } } })
    ).toBeNull();
  });
});

describe("nunca atrapalha mensagem normal", () => {
  it.each([
    ["texto puro", { key: { id: "A" }, message: { conversation: "Oii" } }],
    ["foto", { key: { id: "A" }, message: { imageMessage: { caption: "olha" } } }],
    ["áudio", { key: { id: "A" }, message: { audioMessage: {} } }],
    ["sem message", { key: { id: "A" } }],
    ["vazio", {}],
    ["nulo", null],
    ["texto solto", "isso não é evento"],
  ])("%s não é edição", (_nome, evento) => {
    expect(lerEdicao(evento)).toBeNull();
  });
});

describe("o webhook usa a leitura nova", () => {
  const hook = readFileSync(
    join(process.cwd(), "src/app/api/whatsapp/evolution/webhook/[token]/route.ts"),
    "utf8"
  );

  it("corrige pelo alvo, não pelo id do aviso", () => {
    expect(hook).toContain("const edicao = lerEdicao(m)");
    expect(hook).toContain("externalId: edicao.alvoId");
    // a leitura antiga, que errava o alvo, saiu de cena
    expect(hook).not.toContain("m.message?.editedMessage?.message");
  });

  it("edição sem texto legível só marca “editada”", () => {
    expect(hook).toContain("...(edicao.texto ? { body: edicao.texto } : {})");
    expect(hook).toContain("editedAt: new Date()");
  });
});
