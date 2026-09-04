import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A BUSCA POR PALAVRA, pelo COMPORTAMENTO (banco fingido): o que a lupa
 * promete é que a vendedora só acha o que pode ver, que o número da lista
 * aponta para conversa que está nela, e que o trecho mostra a palavra.
 */
const queryRaw = vi.fn();
const conversationFindMany = vi.fn();
vi.mock("../db", () => ({
  db: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    conversation: { findMany: (...a: unknown[]) => conversationFindMany(...a) },
    company: { findUnique: async () => null },
    message: { findMany: async () => [] },
  },
}));

import { buscarConversas, buscarMensagens } from "../inbox-data";
import type { SessionUser } from "../auth";

const linha = (id: string, conversationId: string, body: string) => ({
  id,
  conversationId,
  createdAt: new Date("2026-09-03T12:00:00Z"),
  direction: "IN",
  body,
});

beforeEach(() => {
  queryRaw.mockReset();
  conversationFindMany.mockReset();
});

const vendedora = {
  id: "u-vendedora",
  name: "Lara",
  email: "l@x",
  companyId: "loja",
  role: "SELLER",
  chatVisaoTotal: false,
} as SessionUser;
const gerente = { ...vendedora, id: "u-gerente", role: "MANAGER" } as SessionUser;

/**
 * A consulta que o `$queryRaw` recebeu, achatada: o Prisma entrega os pedaços
 * de texto no primeiro argumento e os valores nos seguintes — e um fragmento
 * (`Prisma.sql`) chega como objeto com o próprio texto e os próprios valores.
 */
const sqlDaBusca = () => {
  const [tpl, ...valores] = queryRaw.mock.calls[0] as [string[], ...unknown[]];
  const achata = (v: unknown): { texto: string; valores: unknown[] } => {
    const frag = v as { strings?: string[]; values?: unknown[] };
    return frag && Array.isArray(frag.strings)
      ? { texto: frag.strings.join(" ? "), valores: frag.values ?? [] }
      : { texto: "", valores: [v] };
  };
  const partes = valores.map(achata);
  return {
    texto: [...Array.from(tpl ?? []), ...partes.map((p) => p.texto)].join(" "),
    valores: partes.flatMap((p) => p.valores),
  };
};

describe("buscarMensagens", () => {
  it("devolve a mensagem com o trecho em volta da palavra", async () => {
    queryRaw.mockResolvedValue([linha("m1", "minha", "quero a blusa vermelha")]);
    const r = await buscarMensagens(vendedora, "vermelha");
    expect(r.map((m) => m.id)).toEqual(["m1"]);
    expect(r[0].trecho).toEqual({ antes: "quero a blusa ", casa: "vermelha", depois: "" });
  });

  /**
   * O RECORTE MORA NA CONSULTA — e este teste prova isso pelo COMPORTAMENTO:
   * o que o banco devolve é o que sai, sem peneira depois. É a metade que dá
   * para afirmar sem banco; a outra (que a consulta recorta MESMO) foi medida
   * contra o Postgres local na entrega — 400 mensagens recentes das colegas +
   * uma da vendedora, mais antiga: antes ela sobrava ZERO nas 300 trazidas e
   * a tela dizia "Nada encontrado"; agora volta a dela, e só a dela.
   *
   * Por que a peneira não pode voltar: ela roda DEPOIS do teto de resultados,
   * então numa loja movimentada as mais recentes são todas de colegas e não
   * sobra nada (achado da revisão, 03/09/2026).
   */
  it("não peneira depois: o que o banco devolve é o que sai", async () => {
    queryRaw.mockResolvedValue([linha("m1", "da-colega", "blusa canelada")]);
    const r = await buscarMensagens(vendedora, "canelada");
    expect(r.map((m) => m.id)).toEqual(["m1"]);
  });

  it("a vendedora leva o próprio id para o banco; a fila continua visível", async () => {
    queryRaw.mockResolvedValue([]);
    await buscarMensagens(vendedora, "blusa");
    const { texto, valores } = sqlDaBusca();
    expect(valores).toContain(vendedora.id);
    expect(texto).toContain('c."assigneeId" IS NULL');
  });

  it("quem vê a loja inteira não manda recorte nenhum", async () => {
    queryRaw.mockResolvedValue([]);
    await buscarMensagens(gerente, "blusa");
    expect(sqlDaBusca().valores).not.toContain(gerente.id);
  });

  it("a chavinha do chat vale aqui também", async () => {
    queryRaw.mockResolvedValue([]);
    const comChavinha = { ...vendedora, chatVisaoTotal: true } as SessionUser;
    await buscarMensagens(comChavinha, "blusa");
    expect(sqlDaBusca().valores).not.toContain(comChavinha.id);
  });

  it("palavras em outra ordem: acha, e o trecho mostra a primeira delas", async () => {
    queryRaw.mockResolvedValue([linha("m1", "c", "a VERMELHA é a blusa que quero")]);
    const [m] = await buscarMensagens(vendedora, "blusa vermelha");
    expect(m.trecho.casa).toBe("blusa");
  });

  it("sem palavra de 3 letras, nem consulta o banco", async () => {
    expect(await buscarMensagens(vendedora, "ab")).toEqual([]);
    expect(await buscarMensagens(vendedora, "🎉🎉")).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("buscarConversas", () => {
  const user = {
    id: "u",
    name: "Admin",
    email: "a@x",
    companyId: "loja",
    role: "ADMIN",
    chatVisaoTotal: false,
  } as SessionUser;
  const candidata = (id: string, name: string) => ({
    id,
    lastMessageAt: new Date(),
    customer: { name, phone: "", city: null, state: null, cpf: null, cnpj: null, waName: null },
  });

  it("contato primeiro, depois as conversas da palavra, sem repetir — e o lote é carregado em PRÉVIA", async () => {
    conversationFindMany
      .mockResolvedValueOnce([candidata("c1", "Ana Blusa"), candidata("c2", "Bia"), candidata("c3", "Carla")])
      .mockResolvedValueOnce([]); // o lote (mapeamento completo fica fora deste teste)
    queryRaw.mockResolvedValue([
      linha("m1", "c3", "tem blusa?"),
      linha("m2", "c1", "blusa azul"),
      linha("m3", "c9", "blusa da colega (fora do escopo)"),
    ]);
    const r = await buscarConversas(user, "blusa");
    // ordem: c1 (contato), c3 (palavra); c9 nunca — não está no escopo
    const lote = conversationFindMany.mock.calls[1][0] as { where: { id: { in: string[] } }; take?: number };
    expect(lote.where.id.in).toEqual(["c1", "c3"]);
    expect(lote.take).toBeUndefined();
    expect(r.mensagens.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("mensagem de conversa que ficou fora do teto de 60 não volta (apontaria para linha que a lista não tem)", async () => {
    const muitas = Array.from({ length: 70 }, (_, i) => candidata(`c${i}`, `Blusa ${i}`));
    conversationFindMany.mockResolvedValueOnce(muitas).mockResolvedValueOnce([]);
    queryRaw.mockResolvedValue([linha("m1", "c65", "blusa"), linha("m2", "c3", "blusa")]);
    const r = await buscarConversas(user, "blusa");
    const lote = conversationFindMany.mock.calls[1][0] as { where: { id: { in: string[] } } };
    expect(lote.where.id.in).toHaveLength(60);
    expect(r.mensagens.map((m) => m.id)).toEqual(["m2"]);
  });

  it("nada casou: nem consulta o lote", async () => {
    conversationFindMany.mockResolvedValueOnce([candidata("c1", "Ana")]);
    queryRaw.mockResolvedValue([]);
    const r = await buscarConversas(user, "xyz");
    expect(r).toEqual({ conversations: [], mensagens: [] });
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
  });
});
