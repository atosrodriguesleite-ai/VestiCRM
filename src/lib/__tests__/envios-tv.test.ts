import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CORES_TV,
  LADO_DO_MAPA,
  alturaDaColuna,
  avisoDaFalhaDaTv,
  corDaCidade,
  deveAbrirTv,
  fraseDoPlacar,
  impressaoDaEstrada,
  para3d,
  placarDaTv,
  rotulosDaTv,
  temPacoteNaTela,
  textoDoRotulo,
} from "../envios/tv-regra";
import { DIAS_PARA_PARADO } from "../envios/painel";
import { montarNaEstrada, type PontoNaEstrada } from "../envios/mapa";
import { orderScope } from "../scope";
import type { SessionUser } from "../auth";

/* ---- o banco e a sessão de mentira da porta leve ------------------------ */
type Envio = { city: string | null; state: string | null; shippedAt: Date; previstoAte: Date | null };
const estado = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  loja: null as null | { shippingEnabled: boolean; name: string },
  envios: [] as unknown[],
  consultas: [] as { where: unknown; orderBy?: unknown; take?: number }[],
  contagens: [] as unknown[],
  carona: 0,
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
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn(),
}));
vi.mock("@/lib/rastreio", () => ({ atualizarRastreiosSeDevido: async () => void estado.carona++ }));
vi.mock("@/lib/db", () => ({
  db: {
    company: { findUnique: async () => estado.loja },
    shipping: {
      findMany: async (q: { where: unknown; orderBy?: unknown; take?: number }) => {
        estado.consultas.push(q);
        return estado.envios;
      },
      count: async (q: { where: unknown }) => {
        estado.contagens.push(q.where);
        return estado.contagens.length;
      },
    },
    melhorEnvioConnection: { findUnique: async () => ({ fromCity: "Divinópolis", fromState: "MG" }) },
  },
}));

// Guarda RN-104
/**
 * MODO TV DOS ENVIOS: a tela cheia que fica ligada na loja mostra os pacotes
 * a caminho em 3D, pela MESMA camada "na estrada" (RN-103) e a MESMA régua
 * de atraso (RN-102) — a TV só traduz para desenho e texto, nunca decide
 * atraso por conta própria. Aqui se prende a tradução: a cor é STATUS, o
 * rótulo prioriza o problema, o placar diz o que precisa de ação, e a porta
 * leve da TV exige o módulo e recorta pelo escopo de pedidos.
 */
const ponto = (p: Partial<PontoNaEstrada> & { cidade: string | null; uf: string }): PontoNaEstrada => ({
  x: 0,
  y: 0,
  noPrazo: 0,
  atrasados: 0,
  parados: 0,
  ...p,
});

describe("a geometria: do viewBox 2D ao chão 3D", () => {
  it("o centro do mapa vira a origem, para a câmera girar em volta do Brasil", () => {
    expect(para3d(LADO_DO_MAPA / 2, LADO_DO_MAPA / 2)).toEqual({ x: 0, z: 0 });
    expect(para3d(0, 0)).toEqual({ x: -310, z: -310 });
    expect(para3d(620, 310)).toEqual({ x: 310, z: 0 });
  });

  it("a coluna cresce com a raiz: 1 e 40 pacotes cabem na mesma tela, e nunca é negativa", () => {
    expect(alturaDaColuna(0)).toBe(8);
    expect(alturaDaColuna(1)).toBe(17);
    expect(alturaDaColuna(4)).toBe(26);
    expect(alturaDaColuna(40)).toBeLessThan(alturaDaColuna(1) * 5);
    expect(alturaDaColuna(-3)).toBe(8);
  });
});

describe("a cor é STATUS (RN-089): o pior caso da cidade decide", () => {
  it("atrasado vence parado, parado vence no prazo", () => {
    expect(corDaCidade({ atrasados: 1, parados: 3 })).toBe(CORES_TV.atrasado);
    expect(corDaCidade({ atrasados: 0, parados: 1 })).toBe(CORES_TV.parado);
    expect(corDaCidade({ atrasados: 0, parados: 0 })).toBe(CORES_TV.noPrazo);
  });
});

describe("os rótulos: problema primeiro, depois tamanho, com teto", () => {
  const pontos = [
    ponto({ cidade: "Recife", uf: "PE", noPrazo: 9 }),
    ponto({ cidade: "Manaus", uf: "AM", noPrazo: 1, atrasados: 1 }),
    ponto({ cidade: "Curitiba", uf: "PR", noPrazo: 2, parados: 1 }),
    ponto({ cidade: "Belém", uf: "PA", noPrazo: 3 }),
    ponto({ cidade: "Aracaju", uf: "SE", noPrazo: 3 }),
  ];

  it("a cidade com atraso vem antes da maior; parado vem antes do no prazo; empate pelo nome", () => {
    expect(rotulosDaTv(pontos, 10).map((p) => p.cidade)).toEqual(["Manaus", "Curitiba", "Recife", "Aracaju", "Belém"]);
  });

  it("o teto corta a nuvem de texto, e teto zero ou negativo não quebra", () => {
    expect(rotulosDaTv(pontos, 2).map((p) => p.cidade)).toEqual(["Manaus", "Curitiba"]);
    expect(rotulosDaTv(pontos, 0)).toEqual([]);
    expect(rotulosDaTv(pontos, -1)).toEqual([]);
  });

  it("não muda a lista original", () => {
    const antes = pontos.map((p) => p.cidade);
    rotulosDaTv(pontos, 3);
    expect(pontos.map((p) => p.cidade)).toEqual(antes);
  });

  it("o texto diz o problema quando há, e só a contagem quando está tudo no prazo", () => {
    expect(textoDoRotulo(ponto({ cidade: "Manaus", uf: "AM", noPrazo: 1, atrasados: 1 }))).toBe("Manaus · 1 atrasado");
    expect(textoDoRotulo(ponto({ cidade: "Curitiba", uf: "PR", atrasados: 2, parados: 1 }))).toBe("Curitiba · 2 atrasados · 1 parado");
    expect(textoDoRotulo(ponto({ cidade: "Recife", uf: "PE", noPrazo: 3 }))).toBe("Recife · 3");
    // a cidade que não casou com a base vai para o centro do estado e o rótulo diz
    expect(textoDoRotulo(ponto({ cidade: null, uf: "PE", noPrazo: 1 }))).toBe("PE (cidade não identificada) · 1");
  });

  it("'parado' nunca é escrito como 'atrasado' (a régua da RN-102)", () => {
    const texto = textoDoRotulo(ponto({ cidade: "Curitiba", uf: "PR", parados: 2 }));
    expect(texto).toContain("parados");
    expect(texto).not.toMatch(/atrasad/);
  });
});

describe("o placar", () => {
  const base = { aCaminho: 5, atrasados: 0, parados: 0, postadosHoje: 2, entreguesHoje: 1, aguardandoPostagem: 3 };

  it("sem pacote a caminho diz isso; tudo no prazo diz isso; com problema diz qual", () => {
    expect(fraseDoPlacar({ ...base, aCaminho: 0 })).toBe("Nenhum pacote a caminho agora.");
    expect(fraseDoPlacar(base)).toBe("Tudo no prazo. 🚚");
    expect(fraseDoPlacar({ ...base, atrasados: 1 })).toBe("1 atrasado — passou do prazo da transportadora");
    expect(fraseDoPlacar({ ...base, atrasados: 2, parados: 1 })).toBe(
      "2 atrasados — passou do prazo da transportadora · 1 parado há mais de 7 dias (sem prazo)",
    );
  });

  it("o mapa só acende com pacote na estrada", () => {
    expect(temPacoteNaTela({ total: 0 })).toBe(false);
    expect(temPacoteNaTela({ total: 1 })).toBe(true);
  });

  it("o 'há mais de N dias' do parado é o da régua antiga (RN-102), nunca um número solto", () => {
    expect(fraseDoPlacar({ ...base, parados: 1 })).toContain(`há mais de ${DIAS_PARA_PARADO} dias`);
  });

  it("conta TODOS os pacotes lidos — o sem UF fica fora do mapa, não da estrada", () => {
    const pacotes = [
      { cidade: "Manaus", uf: null, situacao: "atrasado" as const },
      { cidade: "Recife", uf: "PE", situacao: "no-prazo" as const },
      { cidade: null, uf: null, situacao: "parado" as const },
    ];
    const placar = placarDaTv(pacotes, { postadosHoje: 1, entreguesHoje: 2, aguardandoPostagem: 3 });
    expect(placar).toEqual({ aCaminho: 3, atrasados: 1, parados: 1, postadosHoje: 1, entreguesHoje: 2, aguardandoPostagem: 3 });
    // o mapa dessa estrada só desenha Recife; o placar não pode dizer "nenhum"
    const estrada = montarNaEstrada(pacotes, null);
    expect(estrada.total).toBe(1);
    expect(fraseDoPlacar(placar)).not.toBe("Nenhum pacote a caminho agora.");
  });
});

describe("a batida que falha diz o que foi — com o texto DESTA tela", () => {
  it("401 é sessão; 403/404 é o módulo Envios (não o BI); o resto é conexão", () => {
    expect(avisoDaFalhaDaTv(401)).toMatch(/sessão venceu/);
    expect(avisoDaFalhaDaTv(403)).toMatch(/módulo Envios/);
    expect(avisoDaFalhaDaTv(404)).toMatch(/módulo Envios/);
    expect(avisoDaFalhaDaTv(403)).not.toMatch(/BI/);
    expect(avisoDaFalhaDaTv(500)).toBe("sem conexão");
    expect(avisoDaFalhaDaTv(null)).toBe("sem conexão");
  });
});

describe("a impressão dos dados: a cena 3D só remonta quando algo mudou", () => {
  const a = montarNaEstrada([{ cidade: "Recife", uf: "PE", situacao: "no-prazo" }], { cidade: "Divinópolis", uf: "MG" });
  it("a mesma foto lida duas vezes tem a mesma impressão; um pacote a mais ou um atraso novo mudam", () => {
    const b = montarNaEstrada([{ cidade: "Recife", uf: "PE", situacao: "no-prazo" }], { cidade: "Divinópolis", uf: "MG" });
    expect(impressaoDaEstrada(a)).toBe(impressaoDaEstrada(b));
    const c = montarNaEstrada([{ cidade: "Recife", uf: "PE", situacao: "atrasado" }], { cidade: "Divinópolis", uf: "MG" });
    expect(impressaoDaEstrada(c)).not.toBe(impressaoDaEstrada(a));
    const d = montarNaEstrada(
      [
        { cidade: "Recife", uf: "PE", situacao: "no-prazo" },
        { cidade: "Belém", uf: "PA", situacao: "no-prazo" },
      ],
      { cidade: "Divinópolis", uf: "MG" },
    );
    expect(impressaoDaEstrada(d)).not.toBe(impressaoDaEstrada(a));
  });
});

describe("abrir pela URL salva na TV da loja", () => {
  it("`?tv=1` e `?tv=true` abrem; o resto não", () => {
    expect(deveAbrirTv("?tv=1")).toBe(true);
    expect(deveAbrirTv("?modo=todos&tv=true")).toBe(true);
    expect(deveAbrirTv("?tv=0")).toBe(false);
    expect(deveAbrirTv("?tv=")).toBe(false);
    expect(deveAbrirTv("")).toBe(false);
  });
});


describe("a porta leve da TV (/api/envios/tv): o COMPORTAMENTO, com banco e sessão de mentira", () => {
  const DIA = 86_400_000;
  const vendedora: SessionUser = { id: "u-ana", companyId: "loja-1", role: "SELLER", name: "Ana", email: "ana@x" } as SessionUser;

  beforeEach(() => {
    estado.user = vendedora as unknown as Record<string, unknown>;
    estado.loja = { shippingEnabled: true, name: "Toque Leve" };
    estado.envios = [];
    estado.consultas = [];
    estado.contagens = [];
    estado.carona = 0;
  });

  async function chamar() {
    const { GET } = await import("@/app/api/envios/tv/route");
    const r = await GET();
    return { status: r.status, corpo: await r.json() };
  }

  it("sem login responde 401; sem o módulo Envios responde 403 e nem lê os envios", async () => {
    estado.user = null;
    expect((await chamar()).status).toBe(401);
    estado.user = vendedora as unknown as Record<string, unknown>;
    estado.loja = { shippingEnabled: false, name: "X" };
    const r = await chamar();
    expect(r.status).toBe(403);
    expect(estado.consultas).toHaveLength(0);
  });

  it("lê só o POSTADO sem entrega, os mais antigos primeiro, no recorte de quem vê (RN-007) — e pega carona no rastreio", async () => {
    const agora = Date.now();
    estado.envios = [
      { city: "Manaus", state: "AM", shippedAt: new Date(agora - 20 * DIA), previstoAte: new Date(agora - 5 * DIA) }, // atrasado
      { city: "Florianópolis", state: "SC", shippedAt: new Date(agora - 9 * DIA), previstoAte: null }, // parado (sem prazo)
      { city: "Recife", state: "PE", shippedAt: new Date(agora - 1 * DIA), previstoAte: new Date(agora + 5 * DIA) }, // no prazo
      { city: "Lugar", state: null, shippedAt: new Date(agora - 1 * DIA), previstoAte: new Date(agora + 5 * DIA) }, // sem UF: fora do mapa, na estrada
    ] satisfies Envio[];
    const r = await chamar();
    expect(r.status).toBe(200);
    // a cláusula: a vendedora vê a TV dos pedidos DELA
    const q = estado.consultas[0];
    expect(q.where).toMatchObject({ meStatus: "POSTADO", deliveredAt: null, shippedAt: { not: null }, order: orderScope(vendedora) });
    expect(orderScope(vendedora)).not.toEqual({}); // o recorte da vendedora não é "a loja inteira"
    expect(q.orderBy).toEqual({ shippedAt: "asc" });
    expect(q.take).toBe(2000);
    for (const where of estado.contagens) expect(where).toMatchObject({ order: orderScope(vendedora) });
    expect(estado.carona).toBe(1);
    // o placar conta os 4 (o sem UF também), a situação sai da régua da RN-102
    expect(r.corpo.placar).toMatchObject({ aCaminho: 4, atrasados: 1, parados: 1 });
    expect(r.corpo.estrada).toMatchObject({ total: 3, atrasados: 1, parados: 1, semEndereco: 1, cortado: false });
    expect(r.corpo.estrada.origem).toMatchObject({ uf: "MG" });
    expect(r.corpo.loja).toBe("Toque Leve");
  });
});
