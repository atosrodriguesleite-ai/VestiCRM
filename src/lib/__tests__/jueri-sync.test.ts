import { describe, it, expect, vi, beforeEach } from "vitest";

// Guarda RN-077 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * A SINCRONIZAÇÃO AUTOMÁTICA DA JUERI ACOMPANHA A JUERI — E DEIXA RASTRO.
 *
 * Relato do dono (09/10/2026): "a cliente mudou as fotos lá na Jueri e não
 * atualiza no sistema; ela vende na Jueri e o estoque aqui não muda". O
 * cartão dizia "última importação 06/10, 11:13" — hora de clique manual,
 * não de cron. Três defeitos: fotos nunca trocadas, cron sem orçamento de
 * tempo (morria no corte da Vercel sem rastro) e nenhum registro da rodada.
 */

type Linha = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  conexao: { lastSyncPagina: null as number | null, company: { name: "Loja J" } } as Linha | null,
  atualizacoes: [] as Linha[],
  eventos: [] as Linha[],
  erros: [] as Linha[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    jueriConnection: {
      findUnique: async () => estado.conexao,
      update: async (u: { data: Linha }) => {
        estado.atualizacoes.push(u.data);
        return {};
      },
    },
    commEvent: {
      create: async (e: { data: Linha }) => {
        estado.eventos.push(e.data);
        return {};
      },
    },
  },
}));
vi.mock("@/lib/health", () => ({
  logServerError: async (e: Linha) => {
    estado.erros.push(e);
  },
}));
// o módulo importa o cliente HTTP da Jueri, que importa next/server
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

const {
  decidirFotos,
  produtoMudou,
  rodarSyncJueriDoCron,
  syncJueriCompany,
  TIPO_SYNC_JUERI,
  zerarResumo,
} = await import("../jueri-sync");
type ResultadoPagina = import("../jueri-sync").JueriPageResult;

const paginaOk = (temMais: boolean, processados = 40): ResultadoPagina => ({
  ok: true,
  temMais,
  resumo: { ...zerarResumo(), processados },
  exemplos: [],
});
const paginaErro = (msg = "HTTP 500"): ResultadoPagina => ({ ok: false, status: 502, error: msg });

beforeEach(() => {
  estado.conexao = { lastSyncPagina: null, company: { name: "Loja J" } };
  estado.atualizacoes = [];
  estado.eventos = [];
  estado.erros = [];
});

describe("decidirFotos — as fotos da Jueri acompanham a Jueri, as da loja (e da Nuvemshop) ficam", () => {
  const J = "JUERI";
  const aqui = [
    { id: "a", order: 0, source: J },
    { id: "b", order: 1, source: J },
  ];
  const lista = ["http://j/1.jpg", "http://j/2.jpg"];
  it("a Jueri não mudou a lista: não mexe em nada — a curadoria da loja nas fotos da Jueri fica", () => {
    // a loja tirou a foto "b" e deixou só a "a": enquanto a Jueri não mudar, fica assim
    expect(decidirFotos([aqui[0]], lista, lista)).toBeNull();
    expect(decidirFotos(aqui, lista, lista)).toBeNull();
  });
  it("foto trocada lá: apaga as marcadas como da Jueri e cria as de agora, na ordem de lá", () => {
    const d = decidirFotos(aqui, lista, ["http://j/9.jpg", "http://j/1.jpg"]);
    expect(d).toEqual({
      lista: ["http://j/9.jpg", "http://j/1.jpg"],
      apagarIds: ["a", "b"],
      criar: [
        { url: "http://j/9.jpg", order: 0 },
        { url: "http://j/1.jpg", order: 1 },
      ],
      reordenar: [],
    });
  });
  it("só a ORDEM mudou lá: também acompanha (a capa é a primeira)", () => {
    expect(decidirFotos(aqui, lista, [lista[1], lista[0]])).not.toBeNull();
  });
  it("as novas entram NO LUGAR das antigas: foto da loja na frente continua na frente, a de trás continua atrás", () => {
    const existentes = [
      { id: "loja1", order: 0, source: null }, // capa da loja
      { id: "a", order: 1, source: J },
      { id: "b", order: 2, source: J },
      { id: "loja2", order: 3, source: null },
    ];
    const d = decidirFotos(existentes, lista, ["http://j/9.jpg"]);
    expect(d?.apagarIds).toEqual(["a", "b"]);
    expect(d?.criar).toEqual([{ url: "http://j/9.jpg", order: 1 }]);
    // a loja2 sobe de 3 para 2; a loja1 não muda
    expect(d?.reordenar).toEqual([{ id: "loja2", order: 2 }]);
  });
  it("foto da Nuvemshop (link sem a marca) NUNCA é apagada", () => {
    const existentes = [{ id: "ns", order: 0, source: null }];
    const d = decidirFotos(existentes, [], ["http://j/1.jpg"]);
    expect(d?.apagarIds).toEqual([]);
    expect(d?.criar).toEqual([{ url: "http://j/1.jpg", order: 1 }]);
  });
  it("produto que nunca sincronizou fotos: sem foto nenhuma ganha as da Jueri; com fotos de outra origem só anota a lista", () => {
    expect(decidirFotos([], null, ["http://j/1.jpg"])).toEqual({
      lista: ["http://j/1.jpg"],
      apagarIds: [],
      criar: [{ url: "http://j/1.jpg", order: 0 }],
      reordenar: [],
    });
    expect(decidirFotos([{ id: "ns", order: 0, source: null }], null, ["http://j/1.jpg"])).toEqual({
      lista: ["http://j/1.jpg"],
      apagarIds: [],
      criar: [],
      reordenar: [],
    });
  });
  it("a Jueri apagou todas as fotos: as marcadas saem, as da loja ficam", () => {
    const d = decidirFotos([...aqui, { id: "loja1", order: 2, source: null }], lista, []);
    expect(d).toEqual({ lista: [], apagarIds: ["a", "b"], criar: [], reordenar: [{ id: "loja1", order: 0 }] });
  });
  it("lerListaDeFotos tolera lixo", async () => {
    const { lerListaDeFotos } = await import("../jueri-sync");
    expect(lerListaDeFotos(null)).toBeNull();
    expect(lerListaDeFotos("não é json")).toBeNull();
    expect(lerListaDeFotos('["a", 1, "b"]')).toEqual(["a", "b"]);
  });
});

describe("produtoMudou — o que já está igual não vai ao banco", () => {
  const ex = { jueriId: "7", wholesalePrice: 30, retailPrice: 50, costPrice: 10, active: true };
  it("igual em tudo: não mudou", () => {
    expect(produtoMudou(ex, { jueriId: "7", atacado: 30, varejo: 50, custo: 10, ativo: true })).toBe(false);
  });
  it("preço, custo, ativo ou vínculo diferente: mudou", () => {
    expect(produtoMudou(ex, { jueriId: "7", atacado: 31, varejo: 50, custo: 10, ativo: true })).toBe(true);
    expect(produtoMudou(ex, { jueriId: "7", atacado: 30, varejo: 50, custo: 10, ativo: false })).toBe(true);
    expect(produtoMudou({ ...ex, jueriId: null }, { jueriId: "7", atacado: 30, varejo: 50, custo: 10, ativo: true })).toBe(true);
  });
});

describe("syncJueriCompany — orçamento de tempo e retomada", () => {
  it("sem prazo: vai até a última página e soma o resumo", async () => {
    const chamadas: number[] = [];
    const out = await syncJueriCompany("c", {
      sincronizarPagina: async (_c, pg) => {
        chamadas.push(pg);
        return paginaOk(pg < 3);
      },
    });
    expect(chamadas).toEqual([1, 2, 3]);
    expect(out).toMatchObject({ ok: true, ultimaPagina: 3 });
    expect(out.parcial).toBeUndefined();
    expect(out.resumo.processados).toBe(120);
  });

  it("prazo vencido: para ENTRE páginas, sempre com pelo menos uma feita, e diz a próxima", async () => {
    const chamadas: number[] = [];
    const out = await syncJueriCompany("c", {
      prazo: Date.now() - 1, // já venceu antes de começar
      sincronizarPagina: async (_c, pg) => {
        chamadas.push(pg);
        return paginaOk(true);
      },
    });
    expect(chamadas).toEqual([1]);
    expect(out).toMatchObject({ ok: true, parcial: true, proximaPagina: 2, ultimaPagina: 1 });
  });

  it("retoma da página pedida, não da primeira", async () => {
    const chamadas: number[] = [];
    const out = await syncJueriCompany("c", {
      paginaInicial: 7,
      sincronizarPagina: async (_c, pg) => {
        chamadas.push(pg);
        return paginaOk(pg < 8);
      },
    });
    expect(chamadas).toEqual([7, 8]);
    expect(out.ok).toBe(true);
  });

  it("página que falha ganha UMA nova tentativa; falhando de novo, diz a página e a próxima rodada volta nela", async () => {
    let tentativas = 0;
    const out = await syncJueriCompany("c", {
      sincronizarPagina: async (_c, pg) => {
        if (pg === 2) {
          tentativas += 1;
          return paginaErro("A Jueri não retornou os produtos (HTTP 500).");
        }
        return paginaOk(true);
      },
    });
    expect(tentativas).toBe(2);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("parou na página 2");
    expect(out).toMatchObject({ proximaPagina: 2, ultimaPagina: 1 });
  });

  it("soluço numa página só: a segunda tentativa passa e o catálogo segue", async () => {
    let falhou = false;
    const out = await syncJueriCompany("c", {
      sincronizarPagina: async (_c, pg) => {
        if (pg === 2 && !falhou) {
          falhou = true;
          return paginaErro();
        }
        return paginaOk(pg < 3);
      },
    });
    expect(out.ok).toBe(true);
    expect(out.ultimaPagina).toBe(3);
  });
});

describe("rodarSyncJueriDoCron — a rodada deixa rastro", () => {
  // a rodada de verdade lê a Jueri; aqui ela é feita pela conexão SEM token
  // (findUnique devolve só o que o cron lê) — o que interessa é o rastro.
  it("falha: cartão, Central da loja e Saúde (sem alarme), e a página pendente fica para a próxima rodada", async () => {
    // syncJueriPage de verdade vai falhar ao achar a conexão sem token/cliente
    const out = await rodarSyncJueriDoCron("c", Date.now() + 60_000);
    expect(out.ok).toBe(false);
    expect(estado.atualizacoes).toHaveLength(1);
    expect(estado.atualizacoes[0]).toMatchObject({ lastSyncPagina: 1 });
    expect(estado.atualizacoes[0].lastSyncTentativaEm).toBeInstanceOf(Date);
    expect(String(estado.atualizacoes[0].lastSyncErro)).toContain("parou na página 1");
    expect(estado.eventos[0]).toMatchObject({ companyId: "c", type: TIPO_SYNC_JUERI, status: "ERRO" });
    expect(String(estado.eventos[0].error)).toContain("FALHOU");
    expect(estado.erros[0]).toMatchObject({ path: "GET /api/cron/jueri-sync", alarme: false });
    expect(String(estado.erros[0].message)).toContain("Loja J");
  });

  it("retoma da página gravada no cartão", async () => {
    estado.conexao = { lastSyncPagina: 5, company: { name: "Loja J" } };
    const out = await rodarSyncJueriDoCron("c", Date.now() + 60_000);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("parou na página 5");
    expect(estado.atualizacoes[0]).toMatchObject({ lastSyncPagina: 5 });
  });
});
