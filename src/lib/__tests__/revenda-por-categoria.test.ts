// Guarda RN-109
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CATEGORIA_OUTRAS,
  avisoDaCategoria,
  categoriasDoPedido,
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
  precosPedidos: [] as { pago: number; categoria: string | null; regras: unknown }[],
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
    precoDeRevenda: (pago: number, categoria: string | null, o: { regras: unknown }) => {
      estado.precosPedidos.push({ pago, categoria, regras: o.regras });
      return real.precoDeRevenda(pago, categoria, o as Parameters<typeof real.precoDeRevenda>[2]);
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
