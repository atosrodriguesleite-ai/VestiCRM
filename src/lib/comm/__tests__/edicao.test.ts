import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { acharMensagemNaResposta, lerEdicao } from "../edicao";

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

  it.each([
    ["messageKey", { messageKey: { id: "ORIG" } }],
    ["key", { key: { id: "ORIG" } }],
    ["targetMessageId", { targetMessageId: "ORIG" }],
    ["targetId", { targetId: "ORIG" }],
  ])("o alvo pode vir no campo %s (varia com o servidor)", (_nome, campos) => {
    expect(
      lerEdicao({
        key: { id: "AVISO" },
        message: { secretEncryptedMessage: { encPayload: "…", ...campos } },
      })
    ).toEqual({ alvoId: "ORIG", texto: "" });
  });

  /**
   * Incidente Giovana, 13/08/2026: o aviso cifrado chegou SEM o alvo e a
   * leitura devolvia null — a conversa ganhava a bolha enigmática
   * "(secretEncryptedMessage)". Continua sendo uma EDIÇÃO: quem recebe
   * decide o resgate (o webhook confere a conversa inteira no servidor).
   */
  it("sem saber o alvo AINDA é edição — alvoId null, nunca bolha de código", () => {
    expect(
      lerEdicao({ key: { id: "A" }, message: { secretEncryptedMessage: { encPayload: "…" } } })
    ).toEqual({ alvoId: null, texto: "" });
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
    expect(hook).toContain("aplicarEdicao(companyId, edicao.alvoId");
    // a leitura antiga, que errava o alvo, saiu de cena
    expect(hook).not.toContain("m.message?.editedMessage?.message");
  });

  it("a edição ACORDA o sync (toca a conversa) — senão só aparecia no F5", () => {
    expect(hook).toContain("db.conversation.updateMany({");
    expect(hook).toContain("messages: { some: { externalId: alvoId } }");
  });

  it("edição que chega pelo messages.update também é aplicada — mas SÓ formato reconhecido", () => {
    // conforme a versão do servidor, o texto novo vem NESTE evento — e a
    // gente só olhava o recibo. E eco de conteúdo em recibo de status NÃO é
    // edição: aplicar sobrescreveria corpo derivado e carimbaria "editada".
    expect(hook).toContain("if (u?.message) {");
    expect(hook).toContain("await aplicarEdicao(companyId, edicao.alvoId, edicao.texto)");
    expect(hook).not.toContain("lerMensagemWA({ message: u.message })");
  });

  it("edição cifrada PERGUNTA o texto ao servidor (não manda olhar no celular)", () => {
    // nem toda vendedora tem o celular do WhatsApp na mão — mandar ela
    // conferir no aplicativo não é resposta
    expect(hook).toContain("buscarTextoAtual(");
    expect(hook).toContain("...(texto ? { body: texto } : {})");
    // e a conversa vai junto: é o plano B quando o servidor não filtra por id
    expect(hook).toContain("m.key?.remoteJid");
  });

  it("edição sem texto fica REGISTRADA (para descobrir o formato novo)", () => {
    // mesma lição da mensagem que não entrava: sem o conteúdo bruto, a gente
    // fica adivinhando qual formato o WhatsApp mandou desta vez
    expect(hook).toContain('"edição sem texto legível"');
    // com nome próprio no log, para a lojista achar sem precisar decifrar
    expect(hook).toContain('"wa.edicao.sem-texto"');
  });

  it("sem conseguir o texto nem pelo servidor, ao menos marca “editada”", () => {
    expect(hook).toContain("editedAt: new Date()");
  });

  /**
   * Incidente Giovana, 13/08/2026: aviso cifrado SEM alvo virava a bolha
   * "[mensagem não exibida aqui] (secretEncryptedMessage)". O resgate agora
   * confere a conversa no servidor e corrige o que mudou; quando nada dá,
   * o aviso é honesto e em português.
   */
  it("edição cifrada SEM alvo confere a conversa inteira no servidor", () => {
    expect(hook).toContain("textosAtuaisDaConversa(");
    expect(hook).toContain("if (edicao && !edicao.alvoId) {");
    // eco do servidor não pode sobrescrever corpo derivado de mídia nem
    // mensagem apagada — só texto puro entra na comparação
    expect(hook).toContain('mediaType: "TEXT"');
    expect(hook).toContain("revoked: false");
  });

  it("reentrega do aviso não vira alarme falso (conversa conferida = em dia)", () => {
    // o servidor reentrega o mesmo aviso em reconexões; se a conversa foi
    // conferida e nada diverge, a correção já aconteceu — avisar "o texto
    // não chegou" seria mentira
    expect(hook).toContain("if (conferidas > 0) continue;");
    // e no caminho COM alvo, "já está com o texto novo" conta como sucesso
    expect(hook).toContain("const jaAplicada = await db.message.findFirst({");
  });

  it("quando nada dá, a bolha é um aviso honesto — nunca código de programador", () => {
    expect(hook).toContain("✏️ A cliente editou uma mensagem e o texto novo não chegou");
    // quem editou define o aviso: edição feita pela LOJA no celular não pode
    // culpar a cliente
    expect(hook).toContain("✏️ Uma mensagem enviada pela loja foi editada no celular");
    expect(hook).toContain("m.key?.fromMe");
    expect(hook).toContain("if (avisoEdicaoSemTexto) {");
  });

  it("placeholder de leitura desconhecida NUNCA vira texto de edição", () => {
    // sem este guarda, o "[mensagem não exibida aqui]" do servidor
    // sobrescreveria a mensagem REAL da cliente ao buscar o texto atual
    const lib = readFileSync(join(process.cwd(), "src/lib/comm/edicao.ts"), "utf8");
    expect(lib).toContain("leitura.desconhecida ? \"\" : leitura.text.trim()");
  });
});

describe("achar a mensagem no que o servidor devolve", () => {
  const MSG = { key: { id: "ORIG" }, message: { conversation: "texto novo" } };

  it.each([
    ["lista solta", [MSG]],
    ["embrulhada em messages.records", { messages: { records: [MSG] } }],
    ["dentro de data", { data: [MSG] }],
    ["objeto direto", MSG],
  ])("acha %s", (_nome, resposta) => {
    expect(acharMensagemNaResposta(resposta)).toMatchObject({
      key: { id: "ORIG" },
    });
  });

  it("resposta vazia ou torta não quebra", () => {
    for (const nada of [null, undefined, {}, [], "texto", 42, { messages: {} }]) {
      expect(acharMensagemNaResposta(nada)).toBeNull();
    }
  });
});
