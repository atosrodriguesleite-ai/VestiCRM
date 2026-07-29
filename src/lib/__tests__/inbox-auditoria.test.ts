import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AUDITORIA DO WHATSAPP — o que a loja TEM, a loja PRECISA VER.
 *
 * A entrega de velocidade (a tela parou de baixar o histórico inteiro a cada
 * 3s) foi correta, mas abriu três buracos do mesmo tipo: dado gravado no
 * banco que a tela não alcançava. Nenhum deles dá erro — a tela só mostra
 * menos, em silêncio, que é o pior jeito de falhar.
 *
 *  1. conversa que chega pelo sync vinha com uma mensagem só;
 *  2. mensagens além das 100 primeiras ficavam inacessíveis;
 *  3. a lupa só olhava as 200 conversas carregadas.
 */
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
const loader = ler("src/lib/inbox-data.ts");
const rotaLista = ler("src/app/api/conversations/route.ts");
const rotaMsgs = ler("src/app/api/conversations/[id]/mensagens/route.ts");

describe("1) conversa nova para a tela vem com histórico", () => {
  it("a tela busca a conversa inteira quando não a conhece", () => {
    expect(inbox).toMatch(/!idsNaTela\.current\.has\(c\.id\)/);
    expect(inbox).toMatch(/fetch\(`\/api\/conversations\/\$\{c\.id\}`\)/);
  });
});

describe("2) o começo da conversa não fica inacessível", () => {
  it("existe a porta das mensagens anteriores", () => {
    expect(rotaMsgs).toContain("export async function GET");
    expect(rotaMsgs).toContain("createdAt: { lt: antes }");
  });

  it("ela é da loja de quem pediu (isolamento)", () => {
    expect(rotaMsgs).toContain("conversationScope(user)");
  });

  it("avisa se ainda há passado (o botão some quando acaba)", () => {
    expect(rotaMsgs).toContain("temMais");
    expect(inbox).toContain("semMais");
    expect(inbox).toContain("Ver mensagens anteriores");
  });

  it("não repete mensagem que já está na tela", () => {
    const f = inbox.slice(inbox.indexOf("async function carregarAnteriores"));
    expect(f).toContain("jaTem.has(m.id)");
  });
});

describe("3) a lupa varre a loja inteira", () => {
  it("a rota aceita busca", () => {
    expect(rotaLista).toContain('searchParams.get("q")');
    expect(rotaLista).toContain("buscarConversas");
  });

  it("o casamento ignora acento (o banco sozinho não ignora)", () => {
    const f = loader.slice(loader.indexOf("export async function buscarConversas"));
    expect(f).toContain("casaCliente");
    // a varredura NÃO pode carregar mensagem de todas as conversas
    expect(f).toContain("select: {");
    expect(f).not.toMatch(/messages:\s*\{/);
  });

  it("a busca respeita o isolamento por loja", () => {
    const f = loader.slice(loader.indexOf("export async function buscarConversas"));
    expect(f).toContain("conversationScope(user)");
  });

  it("a tela consulta o servidor ao digitar", () => {
    expect(inbox).toMatch(/\/api\/conversations\?q=\$\{encodeURIComponent\(q\)\}/);
  });
});

describe("o formato da mensagem é um só", () => {
  it("carga inicial, sync e histórico usam o mesmo mapeamento", () => {
    expect(loader).toContain("export function mapMessage");
    expect(rotaMsgs).toContain("mapMessage");
    // duas cópias divergindo entregam mensagem antiga sem autor/recibo
    expect((loader.match(/authorName: m\.author\?\.name/g) ?? []).length).toBe(1);
  });
});
