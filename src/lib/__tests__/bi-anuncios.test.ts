// Guarda RN-085
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAID_ORDER_STATUSES } from "../orders";

// O BANCO SIMULADO prende a régua das consultas (o padrão da curva ABC):
// o que importa é COM QUE ARGUMENTOS o motor pergunta ao banco e o que faz
// com a resposta — não a forma do texto.
type Chamada = { modelo: string; args: Record<string, unknown> };
const chamadas: Chamada[] = [];
const banco = {
  campanhas: [
    { id: "A", name: "Story outubro", channel: "INSTAGRAM", active: true },
    { id: "B", name: "Google", channel: "GOOGLE", active: true },
  ],
  gastos: [{ campanhaId: "A", mes: "2026-10", valor: 100 }],
  // a coorte do período: k2 e k3 chegaram por A; k9 por B
  coorte: [
    { id: "k2", campaignId: "A" },
    { id: "k3", campaignId: "A" },
    { id: "k9", campaignId: "B" },
  ],
  // quem pagou no período: k2 (da coorte, A), k1 (chegou ANTES do período, A) e k8 (cliente de B)
  quemPagou: [
    { customerId: "k2", _sum: { netTotal: 200 } },
    { customerId: "k1", _sum: { netTotal: 50.004 } },
    { customerId: "k8", _sum: { netTotal: 30 } },
  ],
  foraDaCoorte: [
    { id: "k1", campaignId: "A" },
    { id: "k8", campaignId: "B" },
  ],
};
vi.mock("../db", () => ({
  db: {
    marketingCampaign: { async findMany(args: Record<string, unknown>) { chamadas.push({ modelo: "marketingCampaign", args }); return banco.campanhas; } },
    biGastoDeAnuncio: { async findMany(args: Record<string, unknown>) { chamadas.push({ modelo: "biGastoDeAnuncio", args }); return banco.gastos; } },
    customer: {
      async findMany(args: { where: Record<string, unknown> }) {
        chamadas.push({ modelo: "customer.findMany", args });
        if ("createdAt" in args.where) return banco.coorte;
        const ids = (args.where.id as { in: string[] }).in;
        return banco.foraDaCoorte.filter((c) => ids.includes(c.id));
      },
      async count(args: Record<string, unknown>) { chamadas.push({ modelo: "customer.count", args }); return 1; },
    },
    order: {
      async groupBy(args: { where: Record<string, unknown>; _sum?: unknown; _count?: unknown }) {
        chamadas.push({ modelo: "order.groupBy", args });
        if (args._sum) return banco.quemPagou;
        // da coorte, quem já pagou: só k2
        const ids = (args.where.customerId as { in: string[] }).in;
        return ids.includes("k2") ? [{ customerId: "k2", _count: 1 }] : [];
      },
    },
  },
}));

import { calcularRetorno, mesesDoPeriodo, montarAnuncios, montarLinhas, somarLinhas } from "../bi/anuncios";

/**
 * RN-085 — o ROI de anúncio do BI compara, na MESMA régua do período, o
 * gasto POR MÊS da campanha (`BiGastoDeAnuncio`, digitado pela gerência)
 * com os contatos que o anúncio trouxe (a coorte: `Customer.campaignId`,
 * atribuição automática da RN-015), quantas delas já pagaram e o que
 * entrou no período das clientes da campanha (caixa, pedido pago pela data
 * do pagamento, `netTotal`). Sem base, nulo — nunca zero disfarçado.
 */

describe("os meses do período", () => {
  it("do primeiro ao último mês tocado, virando o ano", () => {
    expect(mesesDoPeriodo({ de: "2026-10-01", ate: "2026-10-31" })).toEqual(["2026-10"]);
    expect(mesesDoPeriodo({ de: "2026-10-15", ate: "2026-11-02" })).toEqual(["2026-10", "2026-11"]);
    expect(mesesDoPeriodo({ de: "2025-11-20", ate: "2026-02-01" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("período torto não vira lista infinita", () => {
    expect(mesesDoPeriodo({ de: "2026-11-01", ate: "2026-10-01" })).toEqual([]);
    // um ano inteiro (o teto do período) são 13 meses no máximo
    expect(mesesDoPeriodo({ de: "2025-10-14", ate: "2026-10-14" })).toHaveLength(13);
  });
});

describe("as contas do retorno", () => {
  it("CAC = gasto ÷ contatos; custo por venda = gasto ÷ pagaram; retorno = vendido ÷ gasto; conversão = pagaram ÷ contatos", () => {
    expect(calcularRetorno({ gasto: 300, leads: 20, pagaram: 4, vendido: 1200 })).toEqual({
      cac: 15,
      custoPorVenda: 75,
      retorno: 4,
      conversaoPct: 20,
    });
  });
  it("sem base é NULO: sem gasto não há CAC nem retorno; sem contato não há conversão; sem venda não há custo por venda", () => {
    expect(calcularRetorno({ gasto: 0, leads: 5, pagaram: 1, vendido: 100 })).toEqual({ cac: null, custoPorVenda: null, retorno: null, conversaoPct: 20 });
    expect(calcularRetorno({ gasto: 100, leads: 0, pagaram: 0, vendido: 0 })).toEqual({ cac: null, custoPorVenda: null, retorno: 0, conversaoPct: null });
  });
});

describe("as linhas e o total", () => {
  const campanhas = [
    { id: "a", name: "Story outubro", channel: "INSTAGRAM", active: true },
    { id: "b", name: "Google", channel: "GOOGLE", active: false },
    { id: "c", name: "Sem nada", channel: "OUTRO", active: true },
    { id: "d", name: "Só gasto", channel: "FACEBOOK", active: true },
  ];
  const numeros = new Map([
    ["a", { gasto: 200.004, leads: 10, pagaram: 2, vendido: 800.006 }],
    ["b", { gasto: 0, leads: 3, pagaram: 1, vendido: 900 }],
    ["d", { gasto: 50, leads: 0, pagaram: 0, vendido: 0 }],
  ]);
  const linhas = montarLinhas(campanhas, numeros);
  it("só campanha com número vira linha; a parada com número aparece marcada; ordem pelo vendido, depois gasto", () => {
    expect(linhas.map((l) => l.id)).toEqual(["b", "a", "d"]);
    expect(linhas.find((l) => l.id === "b")?.ativa).toBe(false);
    expect(linhas.some((l) => l.id === "c")).toBe(false);
  });
  it("centavos arredondados e as contas por linha", () => {
    const a = linhas.find((l) => l.id === "a")!;
    expect([a.gasto, a.vendido, a.cac, a.custoPorVenda, a.retorno, a.conversaoPct]).toEqual([200, 800.01, 20, 100, 4, 20]);
    const d = linhas.find((l) => l.id === "d")!;
    expect([d.cac, d.custoPorVenda, d.retorno]).toEqual([null, null, 0]);
  });
  it("o total soma as linhas e refaz as contas sobre a soma (não é média das linhas)", () => {
    const t = somarLinhas(linhas);
    expect([t.gasto, t.leads, t.pagaram, t.vendido]).toEqual([250, 13, 3, 1700.01]);
    expect([t.cac, t.custoPorVenda, t.retorno, t.conversaoPct]).toEqual([19.23, 83.33, 6.8, 23]);
    expect(somarLinhas([]).retorno).toBeNull();
  });
});

describe("a leitura, com o banco simulado", async () => {
  const dados = await montarAnuncios("loja", { de: "2026-10-01", ate: "2026-10-31" });
  it("vendido = pedido pago pela data do pagamento, netTotal, de cliente com campanha, AGREGADO no banco (RN-001/RN-002)", () => {
    const caixa = chamadas.find((c) => c.modelo === "order.groupBy" && (c.args as { _sum?: unknown })._sum)!;
    const where = caixa.args.where as Record<string, unknown>;
    expect(where.companyId).toBe("loja");
    expect(where.status).toEqual({ in: [...PAID_ORDER_STATUSES] });
    expect(where.paidAt).toEqual({ gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-11-01T03:00:00.000Z") });
    expect(where.customer).toEqual({ campaignId: { not: null } });
    expect(caixa.args._sum).toEqual({ netTotal: true });
  });
  it("a coorte é só quem chegou NO PERÍODO com campanha — nunca a vida inteira da loja", () => {
    const coorte = chamadas.find((c) => c.modelo === "customer.findMany" && "createdAt" in (c.args.where as object))!;
    const where = coorte.args.where as Record<string, unknown>;
    expect(where.campaignId).toEqual({ not: null });
    expect(where.createdAt).toEqual({ gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-11-01T03:00:00.000Z") });
    // quem pagou e não é da coorte é buscada pelo id, só ela (k1 e k8), recortada pela loja
    const porId = chamadas.find((c) => c.modelo === "customer.findMany" && "id" in (c.args.where as object))!;
    expect(porId.args.where).toEqual({ companyId: "loja", id: { in: ["k1", "k8"] } });
  });
  it("'pagaram' confere pedido pago COM data, só para os ids da coorte", () => {
    const pag = chamadas.find((c) => c.modelo === "order.groupBy" && (c.args as { _count?: unknown })._count)!;
    const where = pag.args.where as Record<string, unknown>;
    expect(where.status).toEqual({ in: [...PAID_ORDER_STATUSES] });
    expect(where.paidAt).toEqual({ not: null });
    expect(where.customerId).toEqual({ in: ["k2", "k3", "k9"] });
  });
  it("os números: A gastou 100, trouxe 2 (1 pagou), vendeu 250 no período (k2 + a antiga k1); B sem gasto vendeu 30", () => {
    const a = dados.linhas.find((l) => l.id === "A")!;
    expect([a.gasto, a.leads, a.pagaram, a.vendido, a.cac, a.custoPorVenda, a.retorno, a.conversaoPct]).toEqual([100, 2, 1, 250, 50, 100, 2.5, 50]);
    const b = dados.linhas.find((l) => l.id === "B")!;
    expect([b.gasto, b.leads, b.pagaram, b.vendido, b.retorno]).toEqual([0, 1, 0, 30, null]);
    expect(dados.semAnuncio).toBe(1);
    expect(dados.meses).toEqual(["2026-10"]);
  });
});

describe("a porta e a aba", () => {
  it("a rota do gasto passa pela porteira do BI, confere a campanha DA LOJA, o valor VISTO, e apaga o mês em branco", () => {
    const rota = readFileSync(join(__dirname, "../../app/api/bi/anuncios/gastos/route.ts"), "utf8");
    expect(rota).toMatch(/porteiraBi\(\)/);
    expect(rota).toMatch(/minhas\.length !== ids\.length/);
    expect(rota).toMatch(/noBanco !== visto/);
    expect(rota).toMatch(/status: 409/);
    expect(rota).toMatch(/valor === null \|\| valor === 0/);
  });
  it("a aba Anúncios existe no BI e o editor remonta por período", () => {
    const abas = readFileSync(join(__dirname, "../../app/(app)/bi/abas.tsx"), "utf8");
    expect(abas).toMatch(/id: "anuncios"/);
    const page = readFileSync(join(__dirname, "../../app/(app)/bi/page.tsx"), "utf8");
    expect(page).toMatch(/montarAnuncios\(user\.companyId, periodo\)/);
    const view = readFileSync(join(__dirname, "../../app/(app)/bi/anuncios-view.tsx"), "utf8");
    expect(view).toMatch(/<GastosDeAnuncio key=\{meses\.join\(","\)\}/);
  });
});
