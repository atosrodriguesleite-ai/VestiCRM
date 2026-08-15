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

const rotaConversa = ler("src/app/api/conversations/[id]/route.ts");

describe("1) nenhuma conversa aparece pela metade", () => {
  it("existe a porta que devolve UMA conversa inteira", () => {
    expect(rotaConversa).toContain("export async function GET");
    expect(rotaConversa).toContain("loadInboxConversations(user, undefined, id)");
  });

  it("pedindo uma conversa, o `since` não corta as mensagens", () => {
    expect(loader).toContain("since && !convId");
    expect(loader).toContain("convId ? { id: convId }");
  });

  it("carregar a conversa não apaga nada da linha da lista", () => {
    const f = inbox.slice(inbox.indexOf("async function carregarThread"));
    expect(f).toContain("...conversation");
  });

  it("abrir a conversa SEMPRE busca o histórico dela no servidor", () => {
    // a raiz do incidente "já respondi e aparece como se nunca tivesse
    // conversado": a tela mostrava o pedaço que o sync tinha mandado
    expect(inbox).toMatch(/fetch\(`\/api\/conversations\/\$\{id\}`\)/);
    expect(inbox).toContain("threadsCarregadas.current.add(id)");
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

/**
 * VOLUME — chat comercial vive com MILHARES de conversas.
 *
 * Medido numa loja de 2.007 conversas e 120 mil mensagens: a abertura
 * pesava 4,5 MB e mostrava só 200 conversas. A lista não pode carregar
 * conversa: carrega a PRÉVIA de cada uma; o histórico vem ao abrir.
 */
describe("preparado para milhares de conversas", () => {
  it("a lista traz UMA mensagem por conversa (a prévia), não o histórico", () => {
    expect(loader).toContain("MENSAGENS_NA_LISTA = 1");
    expect(loader).toContain("soPrevia ? MENSAGENS_NA_LISTA : MENSAGENS_NA_ABERTURA");
  });

  it("a prévia é cortada — pedido do catálogo tem milhares de caracteres", () => {
    expect(loader).toContain("PREVIA_MAX");
    expect(loader).toMatch(/soPrevia && msg\.body\.length > PREVIA_MAX/);
  });

  it("o histórico é buscado ao ABRIR a conversa", () => {
    expect(inbox).toContain("async function carregarThread");
    expect(inbox).toContain("threadsCarregadas");
    expect(inbox).toMatch(/void carregarThread\(id\)/);
  });

  it("conversa não aberta NUNCA recebe mensagem solta do sync", () => {
    // juntar mensagem num histórico que não existe monta conversa pela
    // metade — foi assim que "já respondi" virou incidente
    const f = inbox.slice(inbox.indexOf("const merged = prev.map"));
    expect(f).toContain("!threadsCarregadas.current.has(p.id)");
  });

  it("a tela desenha em blocos (2.000 linhas de uma vez travam o navegador)", () => {
    expect(inbox).toContain("filtered.slice(0, visiveis)");
    expect(inbox).toContain("Mostrar mais");
  });

  it("mas a lista INTEIRA fica na memória: contagem das abas e busca certas", () => {
    // o corte é só de DESENHO — `filtered` continua vindo de `convs` inteiro
    expect(inbox).toMatch(/const list = convs\.filter/);
  });
});
