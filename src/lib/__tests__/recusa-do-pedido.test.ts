import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * RECUSA DO PEDIDO DO CATÁLOGO DEIXA RASTRO (parte da RN-010; o guardião da
 * regra é o envio-pedido.test.ts; a rota inteira é coberta em
 * pedido-catalogo-recusa-rota.test.ts).
 *
 * Relato da Sutilli Semijoias (09/10/2026): a mensagem do pedido chegava no
 * WhatsApp e o pedido não entrava na aba Pedidos, "sempre". A rota recusava
 * e só a tela do celular da cliente sabia por quê — a loja ficava cega.
 */

type Evento = { data: Record<string, unknown> };
type Erro = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  eventos: [] as Evento[],
  erros: [] as Erro[],
  falharCommEvent: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    commEvent: {
      create: async (e: Evento) => {
        if (estado.falharCommEvent) throw new Error("banco fora");
        estado.eventos.push(e);
        return { id: "ev" };
      },
    },
  },
}));

vi.mock("@/lib/health", () => ({
  logServerError: async (input: Erro) => {
    estado.erros.push(input);
  },
}));

const {
  descreverCampoRecusado,
  FONTE_RECUSA_CATALOGO,
  gravarRastroDoCatalogo,
  listarVariacoes,
  registrarRecusaDoPedido,
  textoDaRecusa,
  TETO_VARIACOES_NO_DETALHE,
  TIPO_PEDIDO_RECUSADO,
} = await import("../catalogo/recusa-do-pedido");

const loja = { id: "loja-1", name: "Sutilli Semijoias" };

beforeEach(() => {
  estado.eventos = [];
  estado.erros = [];
  estado.falharCommEvent = false;
});

describe("textoDaRecusa", () => {
  it("diz quem pediu, quantas linhas, o motivo dito à cliente, o detalhe e o protocolo", () => {
    const t = textoDaRecusa({
      status: 404,
      motivo: "Uma das peças deste pedido não está mais disponível.",
      detalhe: 'a peça "Colar Chapa" existe, mas não tem a variação Único / Único',
      clientRef: "cat-abc-123",
      cliente: { nome: "Celia Rosa", telefone: "(35) 99713-3320" },
      itens: 25,
    });
    expect(t).toContain("RECUSADO (404)");
    expect(t).toContain("Celia Rosa · (35) 99713-3320");
    expect(t).toContain("25 linhas");
    expect(t).toContain("Motivo dito à cliente: Uma das peças");
    expect(t).toContain('Detalhe: a peça "Colar Chapa"');
    expect(t).toContain("Protocolo: cat-abc-123");
    // o caminho de recuperação que já existe (RN-012) é apontado
    expect(t).toContain("Colar pedido do WhatsApp");
  });

  it("sem cliente, sem detalhe e sem protocolo não inventa nada", () => {
    const t = textoDaRecusa({ status: 400, motivo: "Dados inválidos", itens: 1 });
    expect(t).toContain("RECUSADO (400) — 1 linha.");
    expect(t).not.toContain("Detalhe:");
    expect(t).not.toContain("Protocolo:");
    expect(t).not.toContain("undefined");
  });

  it("o que vem do corpo da requisição é CORTADO: um nome de 3 KB não engole motivo e protocolo", () => {
    const t = textoDaRecusa({
      status: 400,
      motivo: "Dados inválidos",
      clientRef: "cat-xyz",
      cliente: { nome: "A".repeat(3000), telefone: "9".repeat(500) },
    });
    expect(t.length).toBeLessThan(900);
    expect(t).toContain("Motivo dito à cliente: Dados inválidos");
    expect(t).toContain("Protocolo: cat-xyz");
  });
});

describe("descreverCampoRecusado — a lojista lê em português", () => {
  it("campo em branco", () => {
    expect(
      descreverCampoRecusado({ path: ["items", 0, "size"], code: "too_small", message: "String must contain at least 1 character(s)" })
    ).toBe("tamanho da peça (items.0.size) em branco");
  });
  it("campo faltando e formato inválido", () => {
    expect(
      descreverCampoRecusado({ path: ["customer", "phone"], code: "invalid_type", message: "Required: received undefined" })
    ).toBe("telefone (customer.phone) faltando");
    expect(
      descreverCampoRecusado({ path: ["items", 2, "quantity"], code: "invalid_type", message: "Expected number, received string" })
    ).toBe("quantidade (items.2.quantity) em formato inválido");
  });
  it("campo comprido demais e campo que a lista não conhece", () => {
    expect(descreverCampoRecusado({ path: ["message"], code: "too_big" })).toBe(
      "mensagem do WhatsApp (message) comprido demais"
    );
    expect(descreverCampoRecusado({ path: ["xyz"], code: "custom" })).toBe("campo xyz (xyz) inválido");
    expect(descreverCampoRecusado({ path: [], code: "invalid_type", message: "Expected object, received null" })).toBe(
      "campo (raiz) ((raiz)) em formato inválido"
    );
  });
});

describe("listarVariacoes", () => {
  it("lista com teto e diz quantas sobraram", () => {
    const vs = Array.from({ length: TETO_VARIACOES_NO_DETALHE + 5 }, (_, i) => ({ color: `Cor ${i}`, size: "M" }));
    const t = listarVariacoes(vs);
    expect(t).toContain("Cor 0 / M");
    expect(t).toContain(`Cor ${TETO_VARIACOES_NO_DETALHE - 1} / M`);
    expect(t).not.toContain(`Cor ${TETO_VARIACOES_NO_DETALHE} / M`);
    expect(t).toContain("e mais 5");
    expect(listarVariacoes([])).toBe("nenhuma");
  });
});

describe("registrarRecusaDoPedido", () => {
  it("com loja conhecida grava na Central de Comunicação DA LOJA e na Saúde com fonte própria, sem alarme", async () => {
    await registrarRecusaDoPedido(loja, {
      status: 409,
      motivo: "Este link de preço não está mais valendo.",
      clientRef: "cat-x",
    });
    expect(estado.eventos).toHaveLength(1);
    expect(estado.eventos[0].data).toMatchObject({
      companyId: "loja-1",
      direction: "IN",
      type: TIPO_PEDIDO_RECUSADO,
      status: "ERRO",
    });
    expect(String(estado.eventos[0].data.error)).toContain("link de preço");
    expect(estado.erros).toHaveLength(1);
    // fonte PRÓPRIA (fora da lista e da conta de erros da Saúde, como a
    // tela.versao da RN-066) e sem o alarme "🚨 Erro em produção": recusa é
    // resposta decidida, não emergência
    expect(estado.erros[0]).toMatchObject({
      source: FONTE_RECUSA_CATALOGO,
      path: "POST /api/catalog/order",
      alarme: false,
    });
    expect(String(estado.erros[0].message)).toContain("Sutilli Semijoias: pedido do catálogo recusado (409)");
    expect(String(estado.erros[0].detail)).toContain("loja loja-1 (Sutilli Semijoias)");
  });

  it("sem loja (dados inválidos sem endereço, loja inexistente) vai só para a Saúde", async () => {
    await registrarRecusaDoPedido(null, { status: 404, motivo: "Loja não encontrada" });
    expect(estado.eventos).toHaveLength(0);
    expect(estado.erros).toHaveLength(1);
    expect(String(estado.erros[0].message)).toContain("loja desconhecida");
  });

  it("nunca lança: o banco da Central fora do ar não derruba a resposta à cliente", async () => {
    estado.falharCommEvent = true;
    await expect(
      registrarRecusaDoPedido(loja, { status: 400, motivo: "Dados inválidos" })
    ).resolves.toBeUndefined();
    // e o painel de Saúde ainda recebe
    expect(estado.erros).toHaveLength(1);
  });

  it("a trava de ritmo (RN-044) usa o MESMO caminho de rastro", async () => {
    await gravarRastroDoCatalogo({ loja, tipo: "catalogo.flood", texto: "Enxurrada…", resumo: "trava fechou" });
    expect(estado.eventos[0].data).toMatchObject({ companyId: "loja-1", type: "catalogo.flood" });
    expect(estado.erros[0]).toMatchObject({ source: FONTE_RECUSA_CATALOGO, alarme: false });
  });
});

describe("teto do rastro por IP + loja (RN-044)", () => {
  it("tem chave própria por IP e LOJA, teto de 10, e nenhuma chave sem IP", async () => {
    const { chavesDoRastroDeRecusa, LIMITE_RASTRO_RECUSA_POR_IP } = await import("../rate-limit");
    expect(chavesDoRastroDeRecusa("loja-1", "187.1.2.3")).toEqual(["catrec:loja-1|187.1.2.3"]);
    // sem loja conhecida (dados inválidos sem endereço): só por IP
    expect(chavesDoRastroDeRecusa(null, "187.1.2.3")).toEqual(["catrec:?|187.1.2.3"]);
    expect(chavesDoRastroDeRecusa("loja-1", null)).toEqual([]);
    expect(LIMITE_RASTRO_RECUSA_POR_IP).toBe(10);
  });
});
