// Guarda RN-086
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAID_ORDER_STATUSES } from "../orders";

/**
 * RN-086 — CLICAR E CAVAR: todo número do BI leva à lista de quem está por
 * trás dele, pela MESMA régua do número (esperando agora pela SQL do painel,
 * sem resposta pelo motor das esperas, contatos por cadastro no período,
 * vendas por pagamento no período com netTotal, carteira pela lista da
 * Recompra), recortada pela loja, com teto dito, e cada linha leva ao
 * caminho de sempre (conversa, ficha, pedido).
 */

type Chamada = { modelo: string; args: Record<string, unknown> };
const chamadas: Chamada[] = [];
vi.mock("../db", () => ({
  db: {
    $queryRaw: async (...partes: unknown[]) => {
      chamadas.push({ modelo: "$queryRaw", args: { sql: String((partes[0] as TemplateStringsArray).join("?")) } });
      const sql = String((partes[0] as TemplateStringsArray).join("?"));
      // a lista "sem resposta" pede só os ids das conversas esperando; a "esperando agora" pede desde quando
      return sql.includes("MIN(m.") ? [{ id: "c3", customerId: "k3", assigneeId: null, desde: new Date("2026-10-12T19:00:00.000Z") }] : [{ id: "c3" }];
    },
    customer: {
      async findMany(args: Record<string, unknown>) {
        chamadas.push({ modelo: "customer.findMany", args });
        return [{ id: "k3", name: "K3", createdAt: new Date("2026-10-12T19:00:00.000Z"), origin: "WHATSAPP", owner: null }];
      },
    },
    user: {
      async findMany(args: Record<string, unknown>) { chamadas.push({ modelo: "user.findMany", args }); return []; },
      async findFirst(args: Record<string, unknown>) { chamadas.push({ modelo: "user.findFirst", args }); return { name: "Ana" }; },
    },
    company: { async findUnique() { return { horarioComercial: null, intakeSlaMinutes: 30 }; } },
    order: {
      async findMany(args: Record<string, unknown>) {
        chamadas.push({ modelo: "order.findMany", args });
        return [{ id: "p1", number: 7, paidAt: new Date("2026-10-13T12:00:00.000Z"), netTotal: 200, status: "PAGO", customer: { name: "K2" }, seller: { name: "Ana" } }];
      },
    },
    marketingCampaign: { async findFirst() { return null; } },
    message: { async findMany() { return []; } },
    conversation: { async findMany() { return []; } },
  },
}));
vi.mock("../recompra", () => ({ dadosDaAbaRecompra: async () => ({ clientes: [] }) }));

import { TETO_DA_LISTA, hrefDaLista, lerFiltro, montarLista } from "../bi/listas";

const sessao = { id: "g", companyId: "loja", name: "G", email: "", role: "MANAGER" as const, color: "", chatVisaoTotal: false, pedidosVisaoTotal: false, prefersDark: false, avatarUrl: null };

describe("o endereço e a leitura do filtro", () => {
  it("monta o endereço só com o que tem, e o lê de volta", () => {
    const href = hrefDaLista({ tipo: "vendas", de: "2026-10-01", ate: "2026-10-31", vendedora: "ana", aba: "vendedoras" });
    expect(href).toBe("/bi/lista?tipo=vendas&de=2026-10-01&ate=2026-10-31&vendedora=ana&aba=vendedoras");
    const params = Object.fromEntries(new URL("http://x" + href).searchParams);
    expect(lerFiltro(params)).toEqual({ tipo: "vendas", de: "2026-10-01", ate: "2026-10-31", vendedora: "ana", aba: "vendedoras" });
  });
  it("recusa tipo fora da lista, dia que não existe, faixa torta e parâmetro repetido", () => {
    expect(lerFiltro({ tipo: "tudo" })).toBeNull();
    expect(lerFiltro({ tipo: "vendas", de: ["2026-10-01", "2026-10-02"] })).toBeNull();
    expect(lerFiltro({ tipo: "contatos", de: "2026-02-30" })).toBeNull();
    expect(lerFiltro({ tipo: "carteira", faixa: "QUENTE" })).toBeNull();
    expect(lerFiltro({ tipo: "carteira", faixa: "ATIVA", freq: "FIEL" })).toEqual({ tipo: "carteira", faixa: "ATIVA", freq: "FIEL" });
  });
});

describe("as listas, com o banco simulado", () => {
  const agora = new Date("2026-10-13T15:00:00.000Z");
  it("esperando agora: a MESMA cláusula do painel, e a linha leva à conversa", async () => {
    const l = await montarLista(sessao, { tipo: "esperando-agora" }, agora);
    const sql = chamadas.find((c) => c.modelo === "$queryRaw")!.args.sql as string;
    expect(sql).toMatch(/"status" <> 'CLOSED'/);
    expect(sql).toMatch(/"lastInboundAt" > COALESCE\(c\."lastOutboundAt", '-infinity'::timestamp\)/);
    // desde a PRIMEIRA mensagem sem resposta (RN-080), não a última
    expect(sql).toMatch(/MIN\(m\."createdAt"\)/);
    expect(sql).toMatch(/m\."direction" = 'IN'/);
    expect(l.linhas[0]).toMatchObject({ titulo: "K3", href: "/whatsapp?conv=c3" });
    expect(l.linhas[0].subtitulo).toContain("na fila");
    // o tom é pelo prazo da LOJA (30 min no simulado): 20 h esperando = passou
    expect(l.linhas[0].tom).toBe("bad");
  });
  it("vendas: pedido pago pela data do pagamento, netTotal, recortado pela loja e pela vendedora; a linha leva ao pedido", async () => {
    chamadas.length = 0;
    const l = await montarLista(sessao, { tipo: "vendas", de: "2026-10-01", ate: "2026-10-31", vendedora: "ana" }, agora);
    const q = chamadas.find((c) => c.modelo === "order.findMany")!.args as { where: Record<string, unknown>; take: number };
    expect(q.where.companyId).toBe("loja");
    expect(q.where.status).toEqual({ in: [...PAID_ORDER_STATUSES] });
    expect(q.where.paidAt).toEqual({ gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-11-01T03:00:00.000Z") });
    expect(q.where.sellerId).toBe("ana");
    expect(q.take).toBe(TETO_DA_LISTA + 1);
    expect(l.titulo).toBe("Vendas de Ana");
    // o formato de moeda usa o espaço fixo (U+00A0) entre "R$" e o número
    const semEspacoFixo = (t?: string) => t?.replace(/\u00a0/g, " ");
    expect(l.linhas[0]).toMatchObject({ titulo: "#7 · K2", href: "/pedidos/p1" });
    // o `brl` da casa: inteiro sai sem centavos
    expect(semEspacoFixo(l.linhas[0].destaque)).toBe("R$ 200");
    expect(semEspacoFixo(l.descricao)).toContain("R$ 200");
  });
  it("contatos: cadastro no período, pela carteira; a linha leva à ficha", async () => {
    chamadas.length = 0;
    const l = await montarLista(sessao, { tipo: "contatos", de: "2026-10-12", ate: "2026-10-12", vendedora: "ana" }, agora);
    const q = chamadas.find((c) => c.modelo === "customer.findMany")!.args as { where: Record<string, unknown> };
    expect(q.where).toMatchObject({ companyId: "loja", ownerId: "ana" });
    expect(q.where.createdAt).toEqual({ gte: new Date("2026-10-12T03:00:00.000Z"), lt: new Date("2026-10-13T03:00:00.000Z") });
    expect(l.linhas[0].href).toBe("/clientes/k3");
  });
  it("sem período, as listas de período vêm vazias e dizem", async () => {
    const l = await montarLista(sessao, { tipo: "vendas" }, agora);
    expect(l.linhas).toEqual([]);
    expect(l.descricao).toContain("período");
  });
});

describe("os números do BI apontam para as listas", () => {
  const ler = (p: string) => readFileSync(join(__dirname, "../../app/(app)/bi", p), "utf8");
  it("painel: esperando agora, novos contatos, sem resposta e vendido", () => {
    const page = ler("page.tsx");
    expect(page).toMatch(/hrefDaLista\(\{ tipo: "esperando-agora"/);
    expect(page).toMatch(/lista\("contatos"\)/);
    expect(page).toMatch(/lista\("sem-resposta"\)/);
    expect(page).toMatch(/lista\("vendas"\)/);
  });
  it("vendedoras, anúncios e carteira", () => {
    expect(ler("vendedoras-view.tsx")).toMatch(/lista\("sem-resposta", p\.userId\)/);
    expect(ler("anuncios-view.tsx")).toMatch(/lista\("vendas", l\.id\)/);
    expect(ler("carteira-view.tsx")).toMatch(/tipo: "carteira", faixa: f\.id, freq: q\.id/);
  });
  it("a página da lista passa pela porteira do BI e DIZ que o número é congelado e a lista é de agora", () => {
    const page = ler("lista/page.tsx");
    expect(page).toMatch(/porteiraBiTela\(\)/);
    expect(page).toMatch(/esta lista é de agora/);
  });
  it("a lista 'sem resposta' lê só as conversas que estão esperando, em lotes de ids", () => {
    const src = readFileSync(join(__dirname, "../bi/listas.ts"), "utf8");
    expect(src).toMatch(/LIMIT \$\{TETO_DE_CONVERSAS \+ 1\}/);
    expect(src).toMatch(/ids\.slice\(i, i \+ LOTE_DE_IDS\)/);
  });
});
