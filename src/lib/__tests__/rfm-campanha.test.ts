import { describe, it, expect, vi, beforeEach } from "vitest";
import { IDS_DOS_GRUPOS, mensagemDoGrupo, modeloDeCampanhaDoGrupo } from "../bi/rfm-regra";
import { personalizarCampanha } from "../campanha-mensagem";

// Guarda RN-098
/**
 * O GRUPO DO RFM NO FILTRO DAS CAMPANHAS (Etapa 2 do RFM, pedido do dono):
 * só a gerência, na loja com o BI; sem permissão o público é VAZIO — nunca
 * a loja inteira; e a mensagem pronta de cada grupo é a MESMA do "Chamar".
 */

const banco = vi.hoisted(() => ({
  biEnabled: true,
  grupos: new Map<string, string>(),
  clientes: [] as { id: string; name: string; phone: string; city: string | null; orders: { netTotal: number }[] }[],
  campanha: null as null | { id: string; companyId: string; filterJson: string; message: string; status: string },
  criadas: 0,
  enviados: 0,
  ondeClientes: [] as Record<string, unknown>[],
  user: null as null | { id: string; companyId: string; role: string },
}));
const chamadas: string[] = [];

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUser: async () => {
      if (!banco.user) throw new AuthError("Não autenticado");
      return banco.user;
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    company: {
      async findUnique() {
        chamadas.push("company");
        return { biEnabled: banco.biEnabled };
      },
    },
    customer: {
      async findMany(args: { where: Record<string, unknown> }) {
        chamadas.push("customer.findMany");
        banco.ondeClientes.push(args.where);
        return banco.clientes;
      },
      async findFirst() {
        return { id: "ana" };
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    campaign: {
      async create() {
        banco.criadas++;
        return { id: "nova" };
      },
      async findFirst() {
        return banco.campanha && { ...banco.campanha, sends: [] };
      },
      async update() {
        return {};
      },
    },
    campaignSend: {
      async upsert() {
        banco.enviados++;
        return {};
      },
      async findMany() {
        return [];
      },
    },
  },
}));
vi.mock("@/lib/bi/rfm", () => ({
  async clientesDoRfm() {
    chamadas.push("rfm");
    return [...banco.grupos].map(([id, grupo]) => ({ id, grupo }));
  },
}));

const { evaluateSegment, gruposDoRfmUmaVez, rfmLiberadoPara, grupoDoFiltro, lerFiltroDaCampanha, barreiraDoRfm } =
  await import("../segments");
const rotaCriar = await import("../../app/api/campaigns/route");
const rotaPrevia = await import("../../app/api/campaigns/preview/route");
const rotaPublico = await import("../../app/api/campaigns/[id]/audience/route");

const gerente = { id: "u1", companyId: "loja", role: "MANAGER" } as never;
const vendedora = { id: "u2", companyId: "loja", role: "SELLER" } as never;
const cliente = (id: string) => ({ id, name: id, phone: "5511999990000", city: null, orders: [{ netTotal: 100 }] });
const req = (corpo: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } }) as never;
const params = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => {
  chamadas.length = 0;
  banco.biEnabled = true;
  banco.grupos = new Map([
    ["ana", "NAO_PERDER"],
    ["bia", "CAMPEAS"],
    ["cris", "NAO_PERDER"],
  ]);
  banco.clientes = ["ana", "bia", "cris", "duda"].map(cliente);
  banco.campanha = { id: "c1", companyId: "loja", filterJson: JSON.stringify({ rfmGrupo: "NAO_PERDER" }), message: "Oi {{nome}}", status: "ATIVA" };
  banco.criadas = 0;
  banco.enviados = 0;
  banco.ondeClientes = [];
  banco.user = null;
});

describe("quem pode usar o grupo do RFM", () => {
  it("gerência na loja com o BI; vendedora nunca; BI desligado, ninguém", async () => {
    expect(await rfmLiberadoPara(gerente)).toBe(true);
    expect(await rfmLiberadoPara(vendedora)).toBe(false);
    banco.biEnabled = false;
    expect(await rfmLiberadoPara(gerente)).toBe(false);
  });
});

describe("evaluateSegment com o grupo do RFM", () => {
  it("o público é o grupo de HOJE, cruzado com os outros filtros", async () => {
    const r = await evaluateSegment(gerente, { rfmGrupo: "NAO_PERDER" });
    expect(r.map((c) => c.id).sort()).toEqual(["ana", "cris"]);
  });

  it("sem permissão o público é VAZIO — nunca a loja inteira", async () => {
    expect(await evaluateSegment(vendedora, { rfmGrupo: "NAO_PERDER" })).toEqual([]);
    banco.biEnabled = false;
    expect(await evaluateSegment(gerente, { rfmGrupo: "NAO_PERDER" })).toEqual([]);
    // e nem chega a ler as clientes
    expect(chamadas).not.toContain("customer.findMany");
  });

  it("grupo que não existe (JSON torto salvo) também é vazio, nunca a loja inteira", async () => {
    expect(await evaluateSegment(gerente, { rfmGrupo: "QUALQUER" as never })).toEqual([]);
    expect(await evaluateSegment(gerente, { rfmGrupo: "" as never })).toEqual([]);
    expect(grupoDoFiltro({ rfmGrupo: "toString" as never })).toBeNull();
  });

  it("grupo vazio hoje é público vazio", async () => {
    expect(await evaluateSegment(gerente, { rfmGrupo: "PERDIDAS" })).toEqual([]);
  });

  it("sem o filtro de grupo nada muda: o RFM nem é calculado", async () => {
    const r = await evaluateSegment(vendedora, {});
    expect(r).toHaveLength(4);
    expect(chamadas).not.toContain("rfm");
  });

  it("a tela de Campanhas calcula o RFM UMA vez para todas as campanhas", async () => {
    const gruposDoRfm = gruposDoRfmUmaVez(gerente);
    await Promise.all([
      evaluateSegment(gerente, { rfmGrupo: "NAO_PERDER" }, { gruposDoRfm }),
      evaluateSegment(gerente, { rfmGrupo: "CAMPEAS" }, { gruposDoRfm }),
      evaluateSegment(gerente, { rfmGrupo: "HIBERNANDO" }, { gruposDoRfm }),
    ]);
    expect(chamadas.filter((c) => c === "rfm")).toHaveLength(1);
  });
});

describe("a mensagem da campanha do grupo", () => {
  it("é a MESMA do 'Chamar' do BI depois de personalizada", () => {
    for (const g of IDS_DOS_GRUPOS) {
      const modelo = modeloDeCampanhaDoGrupo(g, "https://catalago.net/loja");
      expect(modelo).toContain("{{nome}}");
      expect(personalizarCampanha(modelo, "Maria Clara")).toBe(mensagemDoGrupo(g, "Maria Clara", "https://catalago.net/loja"));
      expect(personalizarCampanha(modelo, "Contato (82) 99999-0000")).toBe(
        mensagemDoGrupo(g, "Contato (82) 99999-0000", "https://catalago.net/loja")
      );
    }
  });

  it("nunca 'Oi Contato!' nem 'Oi !': o crachá provisório e o nome vazio somem sem deixar vírgula órfã", () => {
    const provisorio = "Contato (11) 9999-0000";
    expect(personalizarCampanha("Oi {{nome}}, tudo bem?", provisorio)).toBe("Oi, tudo bem?");
    expect(personalizarCampanha("Olá, {{nome}}!", provisorio)).toBe("Olá!");
    expect(personalizarCampanha("Bom dia {{nome}}, tudo bem?", provisorio)).toBe("Bom dia, tudo bem?");
    expect(personalizarCampanha("{{nome}}, tudo bem?\n{{nome}}, olha só", "")).toBe("tudo bem?\nolha só");
    expect(personalizarCampanha("Oi {{ nome }}!", "  ")).toBe("Oi!");
    expect(personalizarCampanha("Oi {{NOME}}!", "  Ana   Paula ")).toBe("Oi Ana!");
  });
});

describe("as portas conferem a permissão (o servidor é a tranca, a tela só esconde)", () => {
  it("criar: a vendedora e a loja sem o BI levam 403 e NADA é gravado; a gerência cria", async () => {
    const corpo = { name: "x", message: "y", filter: { rfmGrupo: "NAO_PERDER" } };
    banco.user = vendedora;
    expect((await rotaCriar.POST(req(corpo))).status).toBe(403);
    banco.user = gerente;
    banco.biEnabled = false;
    expect((await rotaCriar.POST(req(corpo))).status).toBe(403);
    expect(banco.criadas).toBe(0);
    banco.biEnabled = true;
    expect((await rotaCriar.POST(req(corpo))).status).toBe(201);
    expect(banco.criadas).toBe(1);
    // grupo fora da lista nem chega a ser gravado
    expect((await rotaCriar.POST(req({ ...corpo, filter: { rfmGrupo: "VIP" } }))).status).toBe(400);
    // sem o grupo, a vendedora cria como sempre
    banco.user = vendedora;
    expect((await rotaCriar.POST(req({ name: "x", message: "y", filter: {} }))).status).toBe(201);
  });

  it("prever: a vendedora leva 403 (não descobre quantas são do grupo)", async () => {
    banco.user = vendedora;
    expect((await rotaPrevia.POST(req({ rfmGrupo: "NAO_PERDER" }))).status).toBe(403);
    banco.user = gerente;
    const r = await rotaPrevia.POST(req({ rfmGrupo: "NAO_PERDER" }));
    expect((await r.json()).count).toBe(2);
  });

  it("disparar: ler o público e marcar enviado são da gerência; nada é marcado pela vendedora", async () => {
    banco.user = vendedora;
    expect((await rotaPublico.GET(req({}), params)).status).toBe(403);
    expect((await rotaPublico.POST(req({ customerId: "ana" }), params)).status).toBe(403);
    expect(banco.enviados).toBe(0);
    banco.user = gerente;
    const r = await rotaPublico.GET(req({}), params);
    expect((await r.json()).customers.map((c: { id: string }) => c.id).sort()).toEqual(["ana", "cris"]);
    expect((await rotaPublico.POST(req({ customerId: "ana" }), params)).status).toBe(200);
    expect(banco.enviados).toBe(1);
  });

  it("filtro salvo que não se lê é RECUSADO — nunca vira 'todas as clientes'", async () => {
    banco.user = gerente;
    banco.campanha!.filterJson = '{"rfmGrupo":"NAO_PER';
    expect((await rotaPublico.GET(req({}), params)).status).toBe(422);
    expect((await rotaPublico.POST(req({ customerId: "ana" }), params)).status).toBe(422);
    expect(banco.enviados).toBe(0);
    expect(chamadas).not.toContain("customer.findMany");
    expect(lerFiltroDaCampanha("null")).toBeNull();
    expect(lerFiltroDaCampanha("[1]")).toBeNull();
    expect(lerFiltroDaCampanha("")).toEqual({});
  });

  it("os dois motivos do cadeado são ditos separados", () => {
    expect(barreiraDoRfm({ role: "SELLER" } as never, true)).toBe("papel");
    expect(barreiraDoRfm({ role: "MANAGER" } as never, false)).toBe("bi");
    expect(barreiraDoRfm({ role: "ADMIN" } as never, true)).toBeNull();
  });
});

describe("cliente bloqueada não entra em campanha nenhuma", () => {
  it("toda campanha consulta só quem não está bloqueada", async () => {
    await evaluateSegment(gerente, {});
    await evaluateSegment(gerente, { rfmGrupo: "NAO_PERDER" });
    expect(banco.ondeClientes).toHaveLength(2);
    for (const onde of banco.ondeClientes) expect(onde).toMatchObject({ companyId: "loja", blockedAt: null });
  });
});
