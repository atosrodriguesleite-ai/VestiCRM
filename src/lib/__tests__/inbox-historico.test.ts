import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "JÁ RESPONDI ESSE CLIENTE E APARECE COMO SE NUNCA TIVESSE CONVERSADO."
 *
 * Incidente real. O sync passou a trazer só o que MUDOU desde a última
 * consulta — ótimo para quem já tem a conversa na tela. Mas a conversa que
 * chega POR ELE (a loja tem mais conversas do que cabe na carga inicial, e a
 * cliente escreveu de novo) vinha com uma mensagem só, e o histórico inteiro
 * ficava invisível até recarregar a página.
 */
const inbox = readFileSync(
  join(process.cwd(), "src/app/(app)/whatsapp/inbox.tsx"),
  "utf8"
);
const rota = readFileSync(
  join(process.cwd(), "src/app/api/conversations/[id]/route.ts"),
  "utf8"
);
const loader = readFileSync(join(process.cwd(), "src/lib/inbox-data.ts"), "utf8");

describe("conversa que chega pelo sync traz o histórico", () => {
  it("existe a porta que devolve UMA conversa inteira", () => {
    expect(rota).toContain("export async function GET");
    expect(rota).toContain("loadInboxConversations(user, undefined, id)");
  });

  it("pedindo uma conversa, o `since` não corta as mensagens", () => {
    // sem isto a porta nova devolveria o mesmo pedaço do sync
    expect(loader).toContain("since && !convId");
    expect(loader).toContain("convId ? { id: convId }");
  });

  it("a tela sabe quais conversas já tem, e busca o histórico das novas", () => {
    expect(inbox).toContain("idsNaTela");
    expect(inbox).toMatch(/!idsNaTela\.current\.has\(c\.id\)/);
    expect(inbox).toMatch(/fetch\(`\/api\/conversations\/\$\{c\.id\}`\)/);
  });

  it("o que veio da carga inicial não é buscado de novo (sem tráfego à toa)", () => {
    expect(inbox).toContain("new Set(conversations.map((c) => c.id))");
  });

  it("buscar histórico não apaga o marcador de não lida", () => {
    const trecho = inbox.slice(inbox.indexOf("HISTÓRICO DAS CONVERSAS NOVAS"));
    expect(trecho).toContain("unreadCount: p.unreadCount");
  });
});
