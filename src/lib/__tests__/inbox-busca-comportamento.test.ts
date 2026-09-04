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

describe("buscarMensagens", () => {
  it("só devolve mensagem de conversa que a pessoa PODE VER", async () => {
    queryRaw.mockResolvedValue([
      linha("m1", "minha", "quero a blusa vermelha"),
      linha("m2", "da-colega", "outra blusa vermelha"),
    ]);
    const r = await buscarMensagens("loja", "vermelha", new Set(["minha"]));
    expect(r.map((m) => m.id)).toEqual(["m1"]);
    expect(r[0].trecho).toEqual({ antes: "quero a blusa ", casa: "vermelha", depois: "" });
  });

  it("palavras em outra ordem: acha, e o trecho mostra a primeira delas", async () => {
    queryRaw.mockResolvedValue([linha("m1", "c", "a VERMELHA é a blusa que quero")]);
    const [m] = await buscarMensagens("loja", "blusa vermelha", new Set(["c"]));
    expect(m.trecho.casa).toBe("blusa");
  });

  it("sem palavra de 3 letras, ou sem nada visível, nem consulta o banco", async () => {
    expect(await buscarMensagens("loja", "ab", new Set(["c"]))).toEqual([]);
    expect(await buscarMensagens("loja", "🎉🎉", new Set(["c"]))).toEqual([]);
    expect(await buscarMensagens("loja", "blusa", new Set())).toEqual([]);
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
