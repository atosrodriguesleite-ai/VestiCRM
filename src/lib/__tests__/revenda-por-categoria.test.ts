// Guarda RN-109
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CATEGORIA_OUTRAS,
  TETO_DE_PECAS_LEMBRADAS,
  avisoDaCategoria,
  cardsDoPedido,
  categoriasDoPedido,
  chaveDoCard,
  lerPrecosDePeca,
  pagosDosCards,
  pecasDoPedido,
  pecasParaLembrar,
  textoDaMargem,
  textoDoDinheiro,
  precosPorPecaSchema,
  valoresDasPecas,
  faixaDePreco,
  lerRegrasDeCategoria,
  pagosPorCategoria,
  precoDeRevenda,
  regraQueVale,
  regrasDoPedido,
  regrasParaLembrar,
  regrasSchema,
} from "../revenda/precos";
import type { SessionUser } from "../auth";

/**
 * O PREÇO DO CATÁLOGO DE REVENDA POR CATEGORIA (RN-109): cada categoria do
 * pedido pode ter margem própria ou preço fixo, por cima da margem geral; o
 * ,90 só vale sobre a margem; o fixo avisa quando fica abaixo do custo; o que
 * está guardado torto é pulado, nunca derruba; a rota lê a categoria do
 * cadastro, cobra pela MESMA conta e lembra as regras sem apagar as de
 * categorias que não estão neste pedido.
 */

/* ---- o banco e a sessão de mentira da rota ----------------------------- */
const estado = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  pedido: null as null | Record<string, unknown>,
  produtos: [] as { id: string; category: string }[],
  gravado: null as null | Record<string, unknown>,
  precosPedidos: [] as { pago: number; categoria: string | null; regras: unknown; pecas?: unknown; chave?: string }[],
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
vi.mock("@/lib/db", () => ({
  db: {
    order: { findFirst: async () => estado.pedido },
    product: { findMany: async () => estado.produtos },
    productImage: { findMany: async () => [] },
    customer: {
      update: async (q: { data: Record<string, unknown> }) => {
        estado.gravado = q.data;
        return {};
      },
    },
  },
}));
// a conta de verdade continua rodando; só anotamos com o que a rota a chamou
vi.mock("@/lib/revenda/precos", async (orig) => {
  const real = await orig<typeof import("@/lib/revenda/precos")>();
  return {
    ...real,
    precoDeRevenda: (pago: number, categoria: string | null, o: { regras: unknown }, chave?: string) => {
      estado.precosPedidos.push({ pago, categoria, regras: o.regras, pecas: (o as { pecas?: unknown }).pecas, chave });
      return real.precoDeRevenda(pago, categoria, o as Parameters<typeof real.precoDeRevenda>[2], chave);
    },
  };
});

const regras = {
  Regatas: { tipo: "margem" as const, valor: 120 },
  Vestidos: { tipo: "fixo" as const, valor: 89.9 },
};

describe("a conta do preço", () => {
  it("categoria sem regra segue a margem geral; margem própria e preço fixo mandam", () => {
    const o = { margemGeral: 100, arredondar: false, regras };
    expect(precoDeRevenda(30, "Conjuntos", o)).toBe(60);
    expect(precoDeRevenda(30, "Regatas", o)).toBeCloseTo(66, 6);
    expect(precoDeRevenda(30, "Vestidos", o)).toBe(89.9);
    expect(precoDeRevenda(45, "Vestidos", o)).toBe(89.9); // fixo é fixo: todas as peças
    expect(regraQueVale("Conjuntos", o)).toEqual({ tipo: "margem", valor: 100 });
    expect(regraQueVale(null, o)).toEqual({ tipo: "margem", valor: 100 });
  });
  it("o ,90 só arredonda a margem — o preço fixo é o digitado", () => {
    const o = { margemGeral: 100, arredondar: true, regras: { ...regras, Shorts: { tipo: "fixo" as const, valor: 50 } } };
    expect(precoDeRevenda(35, "Conjuntos", o)).toBe(69.9);
    expect(precoDeRevenda(30, "Regatas", o)).toBe(65.9);
    expect(precoDeRevenda(30, "Shorts", o)).toBe(50);
  });
  it("peça sem categoria é 'Outras' (e 'Outras' pode ter regra própria)", () => {
    const o = { margemGeral: 100, arredondar: false, regras: { [CATEGORIA_OUTRAS]: { tipo: "fixo" as const, valor: 20 } } };
    expect(precoDeRevenda(10, null, o)).toBe(20);
    expect(precoDeRevenda(10, "  ", o)).toBe(20);
  });
});

describe("o preço por PEÇA manda mais que a categoria", () => {
  const o = { margemGeral: 100, arredondar: true, regras: { Regatas: { tipo: "fixo" as const, valor: 59.9 } }, pecas: { "p-reg|Preto": 49.9 } };
  it("o card com preço próprio sai por ele, sem arredondar; os outros seguem a categoria/margem", () => {
    expect(precoDeRevenda(32, "Regatas", o, "p-reg|Preto")).toBe(49.9);
    expect(precoDeRevenda(32, "Regatas", o, "p-reg|Azul")).toBe(59.9);
    expect(precoDeRevenda(30, "Vestidos", o, "p-ves|Rosa")).toBe(59.9);
    expect(precoDeRevenda(32, "Regatas", o)).toBe(59.9);
    // a faixa da categoria ignora o preço por peça (ele é dito à parte)
    const [reg] = categoriasDoPedido([{ categoria: "Regatas", pago: 32 }]);
    expect(faixaDePreco(reg, o)).toEqual({ de: 59.9, ate: 59.9 });
  });
  it("a chave do card é produto × cor, ou o nome congelado sem produto — a MESMA da rota", () => {
    expect(chaveDoCard("p1", "Regata", "Preto")).toBe("p1|Preto");
    expect(chaveDoCard(null, "Brinde", null)).toBe("Brinde|");
    const cards = cardsDoPedido([
      { categoria: "Regatas", pago: 32, quantidade: 2, productId: "p1", nome: "Regata", cor: "Preto", size: "P" } as never,
      { categoria: "Regatas", pago: 35, quantidade: 1, productId: "p1", nome: "Regata", cor: "Preto" },
      { categoria: null, pago: 5, productId: null, nome: "Brinde", cor: null },
    ]);
    // a primeira linha manda no preço pago (como a rota), as peças somam
    expect(cards).toEqual([
      { chave: "p1|Preto", nome: "Regata", cor: "Preto", categoria: "Regatas", pago: 32, pecas: 3 },
      { chave: "Brinde|", nome: "Brinde", cor: null, categoria: "Outras", pago: 5, pecas: 1 },
    ]);
    expect(pecasDoPedido({ "p1|Preto": 49.9, "p9|X": 10, "Brinde|": 0 }, cards)).toEqual({ "p1|Preto": 49.9 });
    // o aviso da categoria olha só quem sai pela regra: a peça com preço próprio fica de fora
    expect(pagosDosCards(cards, { "p1|Preto": 49.9 })).toEqual([5]);
    expect(pagosDosCards(cards)).toEqual([32, 32, 32, 5]);
    expect(textoDoDinheiro(12.345)).toBe("12,35");
    expect(textoDoDinheiro(99.9)).toBe("99,90");
    expect(textoDaMargem(120)).toBe("120");
    expect(textoDaMargem(12.5)).toBe("12,5");
  });
  it("a porta aceita só número positivo dentro do teto, e a ficha lê pulando o torto", () => {
    expect(precosPorPecaSchema.safeParse({ "p1|Preto": 49.9 }).success).toBe(true);
    expect(precosPorPecaSchema.safeParse({ "p1|Preto": 0 }).success).toBe(false);
    expect(precosPorPecaSchema.safeParse({ "p1|Preto": -1 }).success).toBe(false);
    expect(precosPorPecaSchema.safeParse({ "p1|Preto": 200000 }).success).toBe(false);
    expect(precosPorPecaSchema.safeParse([]).success).toBe(false);
    expect(valoresDasPecas(lerPrecosDePeca({ "p1|Preto": { valor: 49.9, em: "2026-11-06T10:00:00.000Z" }, "p2|": { valor: 0 }, "p3|": { valor: "x" }, "": { valor: 1 } }))).toEqual({ "p1|Preto": 49.9 });
    expect(lerPrecosDePeca(null)).toEqual({});
    expect(lerPrecosDePeca({ "p1|": { valor: 10, em: "torto" } })["p1|"].em).toBe("1970-01-01T00:00:00.000Z");
  });
  it("lembrar: a peça deste pedido é trocada, as de outros ficam, e acima do teto as mais antigas saem", () => {
    const agora = new Date("2026-11-06T12:00:00.000Z");
    const guardadas = {
      "p1|Preto": { valor: 40, em: "2026-10-01T00:00:00.000Z" },
      "p2|Azul": { valor: 70, em: "2026-10-02T00:00:00.000Z" },
    };
    expect(pecasParaLembrar(guardadas, { "p3|": 15 }, ["p1|Preto", "p3|"], agora)).toEqual({
      "p2|Azul": { valor: 70, em: "2026-10-02T00:00:00.000Z" },
      "p3|": { valor: 15, em: agora.toISOString() },
    });
    const muitas = Object.fromEntries(
      Array.from({ length: TETO_DE_PECAS_LEMBRADAS }, (_, i) => [`p${i}|`, { valor: 10, em: new Date(2026, 0, 1, 0, i).toISOString() }])
    );
    const depois = pecasParaLembrar(muitas, { nova: 20 }, ["nova"], agora);
    expect(Object.keys(depois)).toHaveLength(TETO_DE_PECAS_LEMBRADAS);
    expect(depois.nova.valor).toBe(20);
    expect(depois["p0|"]).toBeUndefined(); // a mais antiga saiu
    expect(depois[`p${TETO_DE_PECAS_LEMBRADAS - 1}|`]).toBeDefined();
  });
});

describe("as categorias do pedido", () => {
  const pecas = [
    { categoria: "Vestidos", pago: 45 },
    { categoria: "Regatas", pago: 32 },
    { categoria: "Regatas", pago: 45 },
    { categoria: null, pago: 10 },
    { categoria: "Regatas", pago: 32 },
  ];
  it("agrupa com menor e maior pago, em ordem alfabética e 'Outras' por último — contando PEÇAS, não linhas", () => {
    expect(categoriasDoPedido([{ categoria: "Regatas", pago: 32, quantidade: 12 }])[0].pecas).toBe(12);
    expect(pagosPorCategoria([{ categoria: "Regatas", pago: 32, quantidade: 3 }]).Regatas).toEqual([32, 32, 32]);
    expect(categoriasDoPedido(pecas)).toEqual([
      { nome: "Regatas", pecas: 3, menorPago: 32, maiorPago: 45 },
      { nome: "Vestidos", pecas: 1, menorPago: 45, maiorPago: 45 },
      { nome: CATEGORIA_OUTRAS, pecas: 1, menorPago: 10, maiorPago: 10 },
    ]);
    expect(pagosPorCategoria(pecas).Regatas).toEqual([32, 45, 32]);
  });
  it("a faixa que sai no papel é a conta nas duas pontas", () => {
    const [regatas] = categoriasDoPedido(pecas);
    expect(faixaDePreco(regatas, { margemGeral: 100, arredondar: false, regras: {} })).toEqual({ de: 64, ate: 90 });
    expect(faixaDePreco(regatas, { margemGeral: 100, arredondar: false, regras: { Regatas: { tipo: "fixo", valor: 59.9 } } })).toEqual({ de: 59.9, ate: 59.9 });
  });
  it("o preço fixo avisa: vermelho abaixo do custo, amarelo com margem fina, nada com margem", () => {
    const [regatas] = categoriasDoPedido(pecas);
    expect(avisoDaCategoria(regatas, { tipo: "fixo", valor: 40 }, [32, 45, 32])).toEqual({ tipo: "abaixo-do-custo", pecasAbaixo: 1 });
    expect(avisoDaCategoria(regatas, { tipo: "fixo", valor: 45 }, [32, 45, 32])).toEqual({ tipo: "abaixo-do-custo", pecasAbaixo: 1 });
    const fino = avisoDaCategoria(regatas, { tipo: "fixo", valor: 49.9 }, [32, 45, 32]);
    expect(fino?.tipo).toBe("margem-baixa");
    expect((fino as { margemMinima: number }).margemMinima).toBeCloseTo(10.9, 1);
    expect(avisoDaCategoria(regatas, { tipo: "fixo", valor: 59.9 }, [32, 45, 32])).toBeNull();
    expect(avisoDaCategoria(regatas, { tipo: "margem", valor: 5 }, [32, 45, 32])).toBeNull();
    expect(avisoDaCategoria(regatas, undefined, [32, 45, 32])).toBeNull();
  });
});

describe("o que está guardado e o que se lembra", () => {
  it("lê o JSON da ficha pulando o torto, e o que não é objeto vira nada", () => {
    expect(lerRegrasDeCategoria(null)).toEqual({});
    expect(lerRegrasDeCategoria("x")).toEqual({});
    expect(lerRegrasDeCategoria([1])).toEqual({});
    expect(
      lerRegrasDeCategoria({
        " Regatas ": { tipo: "margem", valor: 120 },
        Vestidos: { tipo: "fixo", valor: "89" },
        Shorts: { tipo: "desconto", valor: 1 },
        Calças: { tipo: "margem", valor: -5 },
        Saias: { tipo: "margem", valor: 5000 },
        Blusas: { tipo: "fixo", valor: 200000 },
        Calcinhas: { tipo: "fixo", valor: 0 },
        "": { tipo: "fixo", valor: 10 },
      })
    ).toEqual({ Regatas: { tipo: "margem", valor: 120 } });
  });
  it("a porta recusa a forma torta e aceita a certa", () => {
    expect(regrasSchema.safeParse(regras).success).toBe(true);
    expect(regrasSchema.safeParse({ Regatas: { tipo: "fixo", valor: -1 } }).success).toBe(false);
    expect(regrasSchema.safeParse({ Regatas: { tipo: "fixo", valor: 0 } }).success).toBe(false); // R$ 0,00 não é preço
    expect(regrasSchema.safeParse({ Regatas: { tipo: "margem", valor: 0 } }).success).toBe(true); // vender pelo custo é decisão
    expect(regrasSchema.safeParse({ ["x".repeat(201)]: { tipo: "margem", valor: 1 } }).success).toBe(false);
    expect(regrasSchema.safeParse({ Regatas: { tipo: "fixo", valor: 200000 } }).success).toBe(false);
    expect(regrasSchema.safeParse({ Regatas: { tipo: "margem", valor: 5000 } }).success).toBe(false);
    expect(regrasSchema.safeParse({ Regatas: { tipo: "margem", valor: Infinity } }).success).toBe(false);
    expect(regrasSchema.safeParse([]).success).toBe(false);
    const demais = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`c${i}`, { tipo: "margem", valor: 1 }]));
    expect(regrasSchema.safeParse(demais).success).toBe(false);
  });
  it("só viaja a regra de categoria que está neste pedido, e que a porta aceita", () => {
    const cats = categoriasDoPedido([{ categoria: "Regatas", pago: 1 }, { categoria: "x".repeat(201), pago: 1 }]);
    expect(regrasDoPedido({ ...regras, ["x".repeat(201)]: { tipo: "fixo", valor: 10 } }, cats)).toEqual({ Regatas: regras.Regatas });
  });
  it("lembrar: a categoria fora deste pedido fica; a tirada nesta janela sai; a nova entra", () => {
    const guardadas = { Vestidos: regras.Vestidos, Conjuntos: { tipo: "margem" as const, valor: 80 } };
    expect(regrasParaLembrar(guardadas, { Regatas: regras.Regatas }, ["Regatas", "Vestidos"])).toEqual({
      Conjuntos: { tipo: "margem", valor: 80 },
      Regatas: regras.Regatas,
    });
  });
});

describe("a rota do PDF de revenda", () => {
  const gerente = { id: "u-g", companyId: "loja-1", role: "MANAGER", name: "Gi", email: "g@x" } as unknown as SessionUser;
  beforeEach(() => {
    estado.user = gerente as unknown as Record<string, unknown>;
    estado.gravado = null;
    estado.precosPedidos = [];
    estado.produtos = [
      { id: "p-reg", category: "Regatas" },
      { id: "p-ves", category: "Vestidos" },
    ];
    estado.pedido = {
      id: "o1",
      number: 327,
      customerId: "c1",
      customer: { name: "Mayara", resaleCategorias: { Conjuntos: { tipo: "margem", valor: 80 }, Vestidos: { tipo: "margem", valor: 50 } } },
      items: [
        { productId: "p-reg", name: "Regata Alça", color: "Preto", unitPrice: 32, quantity: 2, imageUrl: null },
        { productId: "p-ves", name: "Vestido Longo", color: null, unitPrice: 45, quantity: 1, imageUrl: null },
        { productId: null, name: "Brinde", color: null, unitPrice: 5, quantity: 1, imageUrl: null },
      ],
    };
  });
  async function chamar(query: string) {
    const { GET } = await import("@/app/api/orders/[id]/resale-pdf/route");
    const req = new (await import("next/server")).NextRequest(`http://x/api/orders/o1/resale-pdf?${query}`);
    return GET(req, { params: Promise.resolve({ id: "o1" }) });
  }
  it("cobra cada peça pela categoria do cadastro, com as regras da URL, e lembra sem apagar as outras", async () => {
    const cats = encodeURIComponent(JSON.stringify(regras));
    const r = await chamar(`preco=margem&markup=100&cats=${cats}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("pdf");
    // uma conta por card (peça × cor), com a categoria certa e as regras da URL
    expect(estado.precosPedidos.map((p) => [p.pago, p.categoria])).toEqual([
      [32, "Regatas"],
      [45, "Vestidos"],
      [5, null],
    ]);
    expect(estado.precosPedidos[0].regras).toEqual(regras);
    // lembrado: Conjuntos (fora do pedido) fica; Vestidos é trocada pela da URL; Regatas entra
    expect(estado.gravado?.resaleCategorias).toEqual({
      Conjuntos: { tipo: "margem", valor: 80 },
      Regatas: regras.Regatas,
      Vestidos: regras.Vestidos,
    });
  });
  it("o preço por PEÇA da URL chega à conta pela chave do card e fica lembrado; torto é 400", async () => {
    (estado.pedido!.customer as Record<string, unknown>).resalePecas = {
      "p-reg|Preto": { valor: 40, em: "2026-10-01T00:00:00.000Z" },
      "p-outro|Azul": { valor: 70, em: "2026-10-02T00:00:00.000Z" },
    };
    const pecas = encodeURIComponent(JSON.stringify({ "p-ves|": 99.9 }));
    const r = await chamar(`preco=margem&markup=100&pecas=${pecas}`);
    expect(r.status).toBe(200);
    expect(estado.precosPedidos.map((p) => p.chave)).toEqual(["p-reg|Preto", "p-ves|", "Brinde|"]);
    expect(estado.precosPedidos[0].pecas).toEqual({ "p-ves|": 99.9 });
    const lembradas = estado.gravado?.resalePecas as Record<string, { valor: number }>;
    expect(lembradas["p-reg|Preto"]).toBeUndefined(); // peça deste pedido sem preço agora: saiu
    expect(lembradas["p-outro|Azul"].valor).toBe(70); // de outro pedido: fica
    expect(lembradas["p-ves|"].valor).toBe(99.9);
    // a chave que não é card deste pedido não conta nem fica lembrada
    estado.precosPedidos = [];
    await chamar(`preco=margem&markup=100&pecas=${encodeURIComponent(JSON.stringify({ "p-ves|": 80, "p-solta|X": 10 }))}`);
    expect(estado.precosPedidos[0].pecas).toEqual({ "p-ves|": 80 });
    expect((estado.gravado?.resalePecas as Record<string, unknown>)["p-solta|X"]).toBeUndefined();
    expect((await chamar(`preco=margem&markup=100&pecas=${encodeURIComponent('{"p-ves|":0}')}`)).status).toBe(400);
    expect((await chamar("preco=margem&markup=100&pecas=nao-e-json")).status).toBe(400);
  });
  it("sem regra na URL, a categoria deste pedido que tinha regra guardada SAI da ficha (a pessoa a tirou)", async () => {
    const r = await chamar("preco=margem&markup=100");
    expect(r.status).toBe(200);
    expect(estado.gravado?.resaleCategorias).toEqual({ Conjuntos: { tipo: "margem", valor: 80 } });
    expect(estado.precosPedidos[0].regras).toEqual({});
  });
  it("regras tortas na URL são recusadas (400), nunca um PDF com preço inventado", async () => {
    expect((await chamar("preco=margem&markup=100&cats=nao-e-json")).status).toBe(400);
    expect((await chamar(`preco=margem&markup=100&cats=${encodeURIComponent('{"Regatas":{"tipo":"fixo","valor":-3}}')}`)).status).toBe(400);
    expect(estado.gravado).toBeNull();
  });
  it("sem preço, as regras da URL são ignoradas e nada de preço é lembrado", async () => {
    const r = await chamar(`preco=nao&cats=${encodeURIComponent(JSON.stringify(regras))}`);
    expect(r.status).toBe(200);
    expect(estado.gravado).toBeNull();
    expect(estado.precosPedidos).toEqual([]);
  });
});
