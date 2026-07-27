import { describe, it, expect } from "vitest";
import { extractJids, extractRecords } from "../history-import";

/**
 * O servidor de conexão mudou de formato entre versões: às vezes devolve a
 * lista de conversas como array puro, às vezes embrulhada. A leitura tem que
 * aguentar as duas — foi por não aguentar que a importação voltava vazia.
 */
describe("extractJids (lista de conversas do servidor)", () => {
  it("lê array puro com remoteJid", () => {
    expect(
      extractJids([{ remoteJid: "5511999998888@s.whatsapp.net" }])
    ).toEqual(["5511999998888@s.whatsapp.net"]);
  });

  it("lê a lista embrulhada em chats/records", () => {
    expect(extractJids({ chats: [{ id: "5511988887777@s.whatsapp.net" }] })).toEqual([
      "5511988887777@s.whatsapp.net",
    ]);
    expect(extractJids({ records: [{ jid: "5511977776666@s.whatsapp.net" }] })).toEqual([
      "5511977776666@s.whatsapp.net",
    ]);
  });

  it("deixa grupos, status e lixo de fora", () => {
    expect(
      extractJids([
        { id: "120363123456789012@g.us" }, // grupo
        { id: "status@broadcast" },
        { id: "5511999998888@s.whatsapp.net" },
        {},
        null,
      ])
    ).toEqual(["5511999998888@s.whatsapp.net"]);
  });

  it("não repete a mesma conversa", () => {
    const jid = "5511999998888@s.whatsapp.net";
    expect(extractJids([{ id: jid }, { remoteJid: jid }])).toEqual([jid]);
  });

  it("resposta inesperada não quebra a importação", () => {
    expect(extractJids(null)).toEqual([]);
    expect(extractJids("erro")).toEqual([]);
    expect(extractJids({ mensagem: "sem permissão" })).toEqual([]);
  });
});

/**
 * O servidor de conexão devolve as mensagens em formatos diferentes conforme
 * a versão. A leitura precisa aguentar todos — foi por não aguentar que a
 * importação de histórico voltava vazia mesmo com mensagens guardadas.
 */
describe("extractRecords (mensagens do servidor, em qualquer formato)", () => {
  const msg = { key: { id: "AAA" }, message: { conversation: "oi" } };

  it("array puro (versões antigas)", () => {
    expect(extractRecords([msg])).toHaveLength(1);
  });

  it("embrulhado em messages (array)", () => {
    expect(extractRecords({ messages: [msg] })).toHaveLength(1);
  });

  it("embrulhado em messages.records (versões novas, com paginação)", () => {
    expect(
      extractRecords({ messages: { total: 1, pages: 1, currentPage: 1, records: [msg] } })
    ).toHaveLength(1);
  });

  it("embrulhado em records", () => {
    expect(extractRecords({ records: [msg] })).toHaveLength(1);
  });

  it("resposta de erro não quebra a importação", () => {
    expect(extractRecords(null)).toEqual([]);
    expect(extractRecords({ status: 401, error: "Unauthorized" })).toEqual([]);
    expect(extractRecords("erro")).toEqual([]);
  });
});

describe("extractJids — identidade nova do WhatsApp (@lid)", () => {
  it("conversa @lid entra na varredura (antes sumia inteira)", () => {
    expect(extractJids([{ id: "123456789@lid" }])).toEqual(["123456789@lid"]);
  });

  it("grupo e status continuam de fora", () => {
    expect(
      extractJids([{ id: "120363@g.us" }, { id: "status@broadcast" }, { id: "5511999998888@lid" }])
    ).toEqual(["5511999998888@lid"]);
  });
});
