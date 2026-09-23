import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A PORTA DO RELATO (`/api/erro-da-tela`, RN-065).
 *
 * Ela escreve no painel de Saúde com texto que vem do aparelho, então os
 * limites são provados aqui: sem login não entra, quem é a pessoa sai da
 * SESSÃO (nunca do corpo), o caminho é limpo de novo no servidor, o ritmo
 * por pessoa fecha a porta, nada toca o alarme, o mesmo relato não entra
 * duas vezes — e a versão velha que a trava BARROU aparece como quebra.
 */

type Gravado = {
  source: string;
  path?: string | null;
  message: string;
  detail?: string | null;
  alarme?: false;
};

const estado = vi.hoisted(() => ({
  user: null as null | { id: string; companyId: string; role: string; impersonatedBy?: string },
  bloqueado: null as number | null,
  gravados: [] as Gravado[],
  tentativas: [] as string[][],
}));

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUser: async () => {
      if (!estado.user) throw new AuthError("Não autenticado");
      return estado.user;
    },
  };
});

vi.mock("@/lib/health", () => ({
  logServerError: async (input: Gravado) => {
    estado.gravados.push(input);
  },
}));

// o "banco" do painel é o que já foi gravado aqui
vi.mock("@/lib/db", () => ({
  db: {
    errorLog: {
      findFirst: async ({ where }: { where: { detail: { contains: string } } }) =>
        estado.gravados.find((g) => g.detail?.includes(where.detail.contains)) ? { id: "x" } : null,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  chavesDoRelatoDeErro: (id: string) => [`errotela:${id}`],
  segundosDeBloqueio: async () => estado.bloqueado,
  registrarTentativa: async (chaves: string[]) => {
    estado.tentativas.push(chaves);
    return null;
  },
}));

const { POST } = await import("@/app/api/erro-da-tela/route");

function pedido(corpo: unknown) {
  return new Request("https://www.atacadopro.com/api/erro-da-tela", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "iPhone Safari" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  }) as unknown as Parameters<typeof POST>[0];
}

let seq = 0;
function relato(extra: Record<string, unknown> = {}) {
  return {
    id: `rel-${++seq}-abcdef`,
    mensagem: "TypeError: x.map is not a function",
    detalhe: "pilha…",
    caminho: "/pedidos",
    versaoVelha: false,
    recarregouSozinho: false,
    quando: "2026-09-23T15:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  estado.user = { id: "u1", companyId: "loja1", role: "SELLER" };
  estado.bloqueado = null;
  estado.gravados = [];
  estado.tentativas = [];
});

describe("a porta do relato de tela quebrada", () => {
  it("sem login: 401, e nada é gravado", async () => {
    estado.user = null;
    const res = await POST(pedido(relato()));
    expect(res.status).toBe(401);
    expect(estado.gravados).toHaveLength(0);
  });

  it("grava no painel com a marca de tela, a loja e a pessoa DA SESSÃO — sem alarme", async () => {
    const res = await POST(pedido(relato({ companyId: "OUTRA-LOJA", userId: "intruso" })));
    expect(res.status).toBe(200);
    expect(estado.gravados).toHaveLength(1);
    const g = estado.gravados[0];
    expect(g.source).toBe("client");
    expect(g.alarme).toBe(false);
    expect(g.message).toBe("[tela] TypeError: x.map is not a function");
    expect(g.detail).toContain("loja: loja1 · pessoa: u1 (SELLER)");
    expect(g.detail).not.toContain("OUTRA-LOJA");
    expect(g.detail).toContain("navegador: iPhone Safari");
  });

  it("versão velha QUE RECARREGOU: fonte própria (fora da conta), é o esperado", async () => {
    await POST(
      pedido(relato({ versaoVelha: true, recarregouSozinho: true, mensagem: "ChunkLoadError: Loading chunk 1 failed." }))
    );
    const g = estado.gravados[0];
    expect(g.source).toBe("tela.versao");
    expect(g.message).toBe("[tela · versão velha] ChunkLoadError: Loading chunk 1 failed.");
  });

  it("versão velha que a trava BARROU é peça faltando de verdade: entra como quebra", async () => {
    await POST(
      pedido(relato({ versaoVelha: true, recarregouSozinho: false, mensagem: "ChunkLoadError: Loading chunk 1 failed." }))
    );
    const g = estado.gravados[0];
    expect(g.source).toBe("client");
    expect(g.message).toBe("[tela · peça que não carregou] ChunkLoadError: Loading chunk 1 failed.");
  });

  it("o mesmo relato (mesmo id) reenviado depois de uma recarga não entra duas vezes", async () => {
    const r = relato();
    expect((await POST(pedido(r))).status).toBe(200);
    expect((await POST(pedido(r))).status).toBe(200);
    expect(estado.gravados).toHaveLength(1);
  });

  it("o caminho é limpo DE NOVO no servidor — o aparelho não é confiável", async () => {
    await POST(pedido(relato({ caminho: "/catalogo/loja?c=SEGREDO#x" })));
    expect(estado.gravados[0].path).toBe("/catalogo/loja");
  });

  it("corpo fora do formato: 400, nada gravado — e a tentativa conta no ritmo", async () => {
    const res = await POST(pedido(relato({ mensagem: "m".repeat(10_000) })));
    expect(res.status).toBe(400);
    expect(estado.gravados).toHaveLength(0);
    expect(estado.tentativas).toEqual([["errotela:u1"]]);
    expect((await POST(pedido("{não é json"))).status).toBe(400);
    expect((await POST(pedido(relato({ id: undefined })))).status).toBe(400);
  });

  it("ritmo estourado: 429, nada gravado", async () => {
    estado.bloqueado = 600;
    const res = await POST(pedido(relato()));
    expect(res.status).toBe(429);
    expect(estado.gravados).toHaveLength(0);
  });

  it("acesso do Super Admin fica dito no relato", async () => {
    estado.user = { id: "u1", companyId: "loja1", role: "ADMIN", impersonatedBy: "sa" };
    await POST(pedido(relato()));
    expect(estado.gravados[0].detail).toContain("acesso do Super Admin");
  });
});
