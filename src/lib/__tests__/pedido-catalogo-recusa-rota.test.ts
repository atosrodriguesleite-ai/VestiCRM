import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A ROTA DO PEDIDO DO CATÁLOGO DEIXA RASTRO EM CADA RECUSA (RN-010, relato
 * Sutilli 09/10/2026) — e a resposta à cliente é a mesma com ou sem rastro.
 *
 * Cada ramo que recusa (dados inválidos, loja inexistente, link de tabela
 * vencido, peça que não casa) tem que passar pelo `recusar`; o teto por
 * IP + loja (RN-044) para o REGISTRO, nunca a resposta; e o reenvio de um
 * pedido que JÁ ENTROU responde "já registrado" antes de qualquer recusa.
 */

type Linha = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  eventos: [] as Linha[],
  erros: [] as Linha[],
  tentativas: [] as string[][],
  bloqueado: null as number | null,
  loja: { id: "loja-1", name: "Sutilli Semijoias", slug: "sutilli", suspended: false, priceTablesEnabled: false, catalogPriceMode: "VAREJO" } as Linha | null,
  pedidoExistente: null as Linha | null,
  produtos: [] as Linha[],
  tabela: null as Linha | null,
  /** o que o after() do Next ainda está fazendo — o teste espera antes de olhar o rastro */
  pendentes: [] as Promise<unknown>[],
}));

// o after() do Next roda DEPOIS da resposta; aqui ele é guardado e o teste
// espera (`rastro()`) antes de olhar o que foi gravado
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    estado.pendentes.push(Promise.resolve().then(fn));
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    company: { findUnique: async () => estado.loja },
    order: { findUnique: async () => estado.pedidoExistente },
    product: { findMany: async () => estado.produtos },
    productVariant: { findMany: async () => [] },
    commEvent: {
      create: async (e: { data: Linha }) => {
        estado.eventos.push(e.data);
        return { id: "ev" };
      },
    },
    customer: { findFirst: async () => null },
  },
}));

vi.mock("@/lib/health", () => ({
  logServerError: async (input: Linha) => {
    estado.erros.push(input);
  },
}));

vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  segundosDeBloqueio: async () => estado.bloqueado,
  registrarTentativa: async (chaves: string[]) => {
    estado.tentativas.push(chaves);
    return null;
  },
}));

vi.mock("@/lib/catalogo/tabelas-de-preco-servidor", () => ({
  resolverLink: async () => estado.tabela,
}));

// o que vem depois das recusas não interessa aqui e não pode ir ao banco
vi.mock("@/lib/intake", () => ({ intakeLead: async () => { throw new Error("não deveria chegar aqui"); }, normalizePhone: (s: string) => s }));
vi.mock("@/lib/nuvemshop", () => ({ espelharEstoqueSemQuebrar: () => {} }));
vi.mock("@/lib/jueri", () => ({ espelharJueriSemQuebrar: () => {} }));
vi.mock("@/lib/financeiro/porta-vendas", () => ({ sincronizarPedidoSemQuebrar: () => {} }));
vi.mock("@/lib/notify", () => ({ notifyNovoPedido: async () => {} }));
vi.mock("@/lib/catalogo/condicoes-da-campanha-servidor", () => ({ resolverCampanhaDoLink: async () => null }));
vi.mock("@/lib/tracking/engine", () => ({ resolveRef: async () => ({ sellerId: null }), atribuirCampanhaPorUtm: async () => {} }));

const { POST } = await import("@/app/api/catalog/order/route");

function pedido(corpo: unknown, ip = "187.1.2.3") {
  return new Request("https://www.atacadopro.com/api/catalog/order", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(corpo),
  }) as unknown as import("next/server").NextRequest;
}

/** espera o after() terminar (o rastro é gravado depois da resposta) */
async function rastro() {
  await Promise.all(estado.pendentes);
}

const item = { productId: "p1", color: "Único", size: "Único", quantity: 1 };
const base = {
  company: "sutilli",
  customer: { name: "Celia Rosa", phone: "(35) 99713-3320" },
  clientRef: "cat-teste-000001",
};

beforeEach(() => {
  estado.eventos = [];
  estado.erros = [];
  estado.tentativas = [];
  estado.pendentes = [];
  estado.bloqueado = null;
  estado.pedidoExistente = null;
  estado.tabela = null;
  estado.loja = { id: "loja-1", name: "Sutilli Semijoias", slug: "sutilli", suspended: false, priceTablesEnabled: false, catalogPriceMode: "VAREJO" };
  estado.produtos = [
    { id: "p1", name: "Colar Chapa Oval", sku: "C1", retailPrice: 79.9, wholesalePrice: 50, minQuantity: 1, images: [], variants: [{ id: "v1", color: "Único", size: "Único", stock: 3, sku: null }] },
  ];
});

describe("cada recusa deixa rastro, e a resposta não muda", () => {
  it("400 dados inválidos: acha a loja pelo endereço e diz o campo em português", async () => {
    const res = await POST(pedido({ ...base, items: [{ ...item, size: "" }] }));
    await rastro();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dados inválidos" });
    expect(estado.eventos).toHaveLength(1);
    expect(estado.eventos[0]).toMatchObject({ companyId: "loja-1", type: "catalogo.pedido-recusado" });
    const texto = String(estado.eventos[0].error);
    expect(texto).toContain("tamanho da peça (items.0.size) em branco");
    expect(texto).toContain("Celia Rosa");
    expect(texto).toContain("Protocolo: cat-teste-000001");
    expect(texto).not.toMatch(/String must contain/);
    expect(estado.tentativas).toEqual([["catrec:loja-1|187.1.2.3"]]);
    expect(estado.erros[0]).toMatchObject({ source: "catalogo.recusa", alarme: false });
  });

  it("404 loja inexistente: vai só para a Saúde (não há loja para a Central)", async () => {
    estado.loja = null;
    const res = await POST(pedido({ ...base, company: "nao-existe", items: [item] }));
    await rastro();
    expect(res.status).toBe(404);
    expect(estado.eventos).toHaveLength(0);
    expect(estado.erros).toHaveLength(1);
    expect(String(estado.erros[0].detail)).toContain('nenhuma loja com o endereço "nao-existe"');
    expect(estado.tentativas).toEqual([["catrec:?|187.1.2.3"]]);
  });

  it("409 link de tabela vencido deixa rastro com o código do link", async () => {
    estado.loja = { ...estado.loja!, priceTablesEnabled: true };
    const res = await POST(pedido({ ...base, items: [item], link: "abc123" }));
    await rastro();
    expect(res.status).toBe(409);
    expect((await res.json()).linkInvalido).toBe(true);
    expect(String(estado.eventos[0].error)).toContain('link de tabela de preço "abc123"');
  });

  it("404 peça que não casa diz QUAL peça e QUAL variação faltou, e o que a peça tem", async () => {
    const res = await POST(pedido({ ...base, items: [{ ...item, size: "M" }] }));
    await rastro();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("não está mais disponível");
    const texto = String(estado.eventos[0].error);
    expect(texto).toContain('a peça "Colar Chapa Oval" existe, mas não tem a variação Único / M');
    expect(texto).toContain("tem: Único / Único");
  });

  it("reenvio de pedido que JÁ ENTROU responde 'já registrado' ANTES de qualquer recusa — nunca vira recusa falsa", async () => {
    estado.loja = { ...estado.loja!, priceTablesEnabled: true };
    estado.pedidoExistente = { id: "o1", number: 42, customerId: "c1" };
    // o link de tabela já não vale, mas o pedido existe: o aparelho reenviando
    // da fila (RN-010) tem que ouvir "já registrado", senão a lojista lia
    // "RECUSADO" no rastro e colava um pedido que existe
    const res = await POST(pedido({ ...base, items: [item], link: "vencido" }));
    await rastro();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, number: 42, jaRegistrado: true });
    expect(estado.eventos).toHaveLength(0);
    expect(estado.erros).toHaveLength(0);
  });

  it("com o teto do rastro fechado, a resposta é a MESMA e só o registro para", async () => {
    estado.bloqueado = 600;
    const res = await POST(pedido({ ...base, items: [{ ...item, size: "" }] }));
    await rastro();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Dados inválidos" });
    expect(estado.eventos).toHaveLength(0);
    expect(estado.erros).toHaveLength(0);
    expect(estado.tentativas).toHaveLength(0);
  });
});
