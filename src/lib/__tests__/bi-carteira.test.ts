// Guarda RN-084
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resumirCarteira } from "../bi/carteira";
import type { ClienteDeRecompra } from "../recompra";

/**
 * RN-084 — a aba Clientes do BI é a CARTEIRA DA RECOMPRA lida em R × F × M:
 * faixa, ritmo e VIP vêm de `dadosDaAbaRecompra` (fonte única — a aba nunca
 * decide sozinha quem é ativa, esfriando ou VIP); o BI acrescenta as VIPs
 * que esfriaram e as melhores clientes DO PERÍODO. A antiga matriz faixa ×
 * compras saiu: o RFM (RN-093, `bi-rfm.test.ts`) ocupa o lugar dela.
 */

const cliente = (extra: Partial<ClienteDeRecompra>): ClienteDeRecompra => ({
  id: "c",
  name: "C",
  phone: "5511",
  total: 0,
  compras: 1,
  ultimaCompra: "2026-10-01T15:00:00.000Z",
  diasDesde: 10,
  cicloDias: null,
  faixa: "ATIVA",
  passouDoPonto: false,
  vip: null,
  categoriaTop: null,
  aniversarioMes: false,
  ...extra,
});

describe("o resumo da carteira", () => {
  const clientes = [
    cliente({ id: "a", faixa: "ATIVA", compras: 1, total: 100, vip: 2 }),
    cliente({ id: "b", faixa: "ESFRIANDO", compras: 4, total: 400, vip: 1, passouDoPonto: true }),
    cliente({ id: "c", faixa: "SUMIDA", compras: 2, total: 200, passouDoPonto: true }),
    cliente({ id: "d", faixa: "RISCO", compras: 1, total: 300, vip: 3 }),
  ];
  const r = resumirCarteira(clientes);
  it("recompra = 2+ compras ÷ compradoras, a mesma conta do painel de Recompra e do Dashboard", () => {
    expect([r.compradoras, r.recorrentes, r.taxaRecompraPct]).toEqual([4, 2, 50]);
  });
  it("por faixa, quem passou do ponto e o que está na mesa (uma compra média de cada atrasada)", () => {
    expect(r.porFaixa.ATIVA).toEqual({ clientes: 1 });
    expect(r.porFaixa.ESFRIANDO).toEqual({ clientes: 1 });
    expect(r.passouDoPonto).toBe(2);
    expect(r.valorEmRisco).toBe(200); // 400/4 + 200/2
  });
  it("VIPs que esfriaram: só VIP fora da faixa Ativa, da maior para a menor; concentração pelo total histórico", () => {
    expect(r.vipsEsfriando.map((c) => c.id)).toEqual(["b", "d"]);
    expect(r.concentracaoVipPct).toBe(80); // (100+400+300) / 1000
  });
  it("carteira vazia: nulos, nunca zero disfarçado", () => {
    const v = resumirCarteira([]);
    expect([v.taxaRecompraPct, v.concentracaoVipPct, v.compradoras, v.vipsEsfriando]).toEqual([null, null, 0, []]);
  });
});

describe("fonte única", () => {
  const src = readFileSync(join(__dirname, "../bi/carteira.ts"), "utf8");
  it("a aba lê a carteira de `dadosDaAbaRecompra` (leitura leve) e NUNCA decide faixa, ritmo ou VIP por conta própria", () => {
    expect(src).toMatch(/dadosDaAbaRecompra\(user, \{ leve: true \}\)/);
    expect(src).not.toMatch(/faixaFixa\(/);
    expect(src).not.toMatch(/passouDoRitmo\(/);
    expect(src).not.toMatch(/cicloEntreCompras\(/);
    expect(src).not.toMatch(/TOP_VIPS/);
  });
  it("as melhores do período são por pagamento no período e netTotal (RN-001/RN-002), com o nome vindo da carteira", () => {
    expect(src).toMatch(/status: \{ in: PAGOS \}, paidAt: \{ gte: inicio, lt: fim \}/);
    expect(src).toMatch(/_sum: \{ netTotal: true \}/);
    expect(src).not.toMatch(/_sum: \{ total: true \}/);
    expect(src).not.toMatch(/db\.customer\.findMany/);
  });
  it("a recompra do painel segue a MESMA régua da carteira: pedido pago COM data de pagamento", () => {
    const painel = readFileSync(join(__dirname, "../bi/painel.ts"), "utf8");
    expect(painel).toMatch(/by: \["customerId"\], where: \{ companyId, status: \{ in: PAGOS \}, paidAt: \{ not: null \} \}, _count: true/);
  });
  it("a aba da Recompra tem a leitura leve, com a MESMA régua de pedido pago e a mesma carteira", () => {
    const rec = readFileSync(join(__dirname, "../recompra.ts"), "utf8");
    expect(rec).toMatch(/leve\?: boolean/);
    // a régua de "pedido pago com data" é UMA constante para as duas leituras
    expect((rec.match(/where: ONDE_PEDIDO_PAGO/g) ?? []).length).toBe(2);
  });
  it("a aba Clientes existe no BI", () => {
    const abas = readFileSync(join(__dirname, "../bi/abas.ts"), "utf8");
    expect(abas).toMatch(/"clientes"/);
    const page = readFileSync(join(__dirname, "../../app/(app)/bi/page.tsx"), "utf8");
    expect(page).toMatch(/montarCarteira\(user, periodo\)/);
  });
});
