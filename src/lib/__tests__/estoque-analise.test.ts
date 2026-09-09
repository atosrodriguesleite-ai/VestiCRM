// Guarda RN-052
import { describe, it, expect } from "vitest";
import { analisarPeca, DIAS_DO_GIRO, DIAS_PARA_ENCALHAR } from "../estoque/analise";

/**
 * ANÁLISE DE ESTOQUE POR REGRA (RN-052): giro, cobertura, encalhada e o que
 * repor — contas claras, sem IA. A fonte de venda é pedido PAGO (RN-001);
 * a consulta é SQL e o que se guarda aqui é a conta pura sobre o resultado.
 */

const hoje = new Date("2026-09-09T12:00:00Z");
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 86_400_000);
const peca = (disponivel: number, reservado = 0, minimo = 5, custo = 10) => ({
  disponivel,
  emEstoque: disponivel + reservado,
  minimo,
  custo,
});

describe("giro e cobertura", () => {
  it("giro = vendidos em 30 dias ÷ 30; cobertura = disponível ÷ giro, em dias inteiros", () => {
    const a = analisarPeca(peca(20), { vendidos30: 15, ultimaVendaEm: diasAtras(1) }, hoje);
    expect(a.giroDia).toBeCloseTo(0.5);
    expect(a.coberturaDias).toBe(40);
    expect(a.situacao).toBe("OK");
  });

  it("sem venda no período não há cobertura (null) — nunca 'infinito'", () => {
    const a = analisarPeca(peca(20), { vendidos30: 0, ultimaVendaEm: diasAtras(40) }, hoje);
    expect(a.coberturaDias).toBeNull();
    expect(a.situacao).toBe("SEM_VENDA");
  });
});

describe("encalhada", () => {
  it("tem peça e não vende há 60 dias (ou nunca) → encalhada, com o valor parado a CUSTO", () => {
    const nunca = analisarPeca(peca(4, 2, 5, 12.5), undefined, hoje);
    expect(nunca.encalhada).toBe(true);
    expect(nunca.valorParadoCusto).toBe(6 * 12.5);
    const velha = analisarPeca(peca(9), { vendidos30: 0, ultimaVendaEm: diasAtras(DIAS_PARA_ENCALHAR) }, hoje);
    expect(velha.encalhada).toBe(true);
    expect(velha.situacao).toBe("ENCALHADA");
  });

  it("vendeu há 59 dias ainda não encalhou; sem peça na loja nunca encalha", () => {
    expect(
      analisarPeca(peca(9), { vendidos30: 0, ultimaVendaEm: diasAtras(DIAS_PARA_ENCALHAR - 1) }, hoje).encalhada
    ).toBe(false);
    expect(analisarPeca(peca(0), undefined, hoje).encalhada).toBe(false);
  });
});

describe("o que repor", () => {
  it("chegou ao mínimo → repor até cobrir 30 dias de venda, nunca menos que o dobro do mínimo", () => {
    // giro 1/dia: 30 dias pedem 30; dobro do mínimo é 10 → vale 30 − 3 = 27
    const rapida = analisarPeca(peca(3, 0, 5), { vendidos30: DIAS_DO_GIRO, ultimaVendaEm: diasAtras(1) }, hoje);
    expect(rapida.repor).toBe(27);
    expect(rapida.situacao).toBe("REPOR");
    // sem venda: só o dobro do mínimo → 10 − 3 = 7
    const parada = analisarPeca(peca(3, 0, 5), undefined, hoje);
    expect(parada.repor).toBe(7);
  });

  it("acima do mínimo não repõe nada, mesmo vendendo muito", () => {
    const a = analisarPeca(peca(50, 0, 5), { vendidos30: 90, ultimaVendaEm: diasAtras(0) }, hoje);
    expect(a.repor).toBe(0);
    expect(a.coberturaDias).toBe(16);
  });

  it("zerada é ZERADA (vem antes de repor) e a reposição sugerida continua sendo dita", () => {
    const a = analisarPeca(peca(0, 0, 5), { vendidos30: 3, ultimaVendaEm: diasAtras(2) }, hoje);
    expect(a.situacao).toBe("ZERADA");
    expect(a.repor).toBe(10);
  });

  it("mínimo 0: só zerada repõe, e repõe pelo giro (dobro de 0 é 0)", () => {
    const a = analisarPeca(peca(0, 0, 0), { vendidos30: 6, ultimaVendaEm: diasAtras(2) }, hoje);
    expect(a.repor).toBe(6);
    expect(analisarPeca(peca(1, 0, 0), undefined, hoje).repor).toBe(0);
  });
});
