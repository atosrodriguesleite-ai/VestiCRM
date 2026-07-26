import { describe, it, expect } from "vitest";
import { extractJids } from "../history-import";

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
