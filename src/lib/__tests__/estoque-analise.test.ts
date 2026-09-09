// Guarda RN-052
import { describe, it, expect } from "vitest";
import { analisarPeca, DIAS_DO_GIRO, DIAS_PARA_ENCALHAR, resumirPainel } from "../estoque/analise";
import type { LinhaDoInventario } from "../estoque/inventario";

/**
 * ANÁLISE DE ESTOQUE POR REGRA (RN-052): giro, cobertura, encalhada e o que
 * repor — contas claras, sem IA. A fonte de venda é pedido PAGO (RN-001);
 * a consulta é SQL e o que se guarda aqui é a conta pura sobre o resultado.
 */

const hoje = new Date("2026-09-09T12:00:00Z");
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 86_400_000);
const peca = (disponivel: number, reservado = 0, minimo = 5, custo = 10, cadastradaHa = 365) => ({
  disponivel,
  emEstoque: disponivel + reservado,
  minimo,
  custo,
  cadastradoEm: diasAtras(cadastradaHa).toISOString(),
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
  it("tem peça DISPONÍVEL e não vende há 60 dias → encalhada, com o valor parado a CUSTO (em estoque × custo)", () => {
    const velha = analisarPeca(peca(9, 2, 5, 12.5), { vendidos30: 0, ultimaVendaEm: diasAtras(DIAS_PARA_ENCALHAR) }, hoje);
    expect(velha.encalhada).toBe(true);
    expect(velha.valorParadoCusto).toBe(11 * 12.5);
    expect(velha.situacao).toBe("ENCALHADA");
  });

  it("quem NUNCA vendeu conta do CADASTRO: a coleção que entrou ontem não é encalhada; a de 60 dias é", () => {
    const nova = analisarPeca(peca(50, 0, 5, 40, 1), undefined, hoje);
    expect(nova.encalhada).toBe(false);
    expect(nova.diasDeCadastro).toBe(1);
    expect(nova.situacao).toBe("SEM_VENDA");
    const antiga = analisarPeca(peca(4, 0, 5, 40, DIAS_PARA_ENCALHAR), undefined, hoje);
    expect(antiga.encalhada).toBe(true);
  });

  it("vendeu há 59 dias ainda não encalhou; só reservada (disponível 0) não é parada — tem dono", () => {
    expect(
      analisarPeca(peca(9), { vendidos30: 0, ultimaVendaEm: diasAtras(DIAS_PARA_ENCALHAR - 1) }, hoje).encalhada
    ).toBe(false);
    expect(analisarPeca(peca(0, 6), undefined, hoje).encalhada).toBe(false);
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

describe("o painel inteiro (resumo puro)", () => {
  const linha = (
    id: string,
    disponivel: number,
    extra: Partial<LinhaDoInventario> = {}
  ): LinhaDoInventario => ({
    variantId: id,
    productId: `p-${id}`,
    produto: `Peça ${id}`,
    categoria: "Vestidos",
    cor: "Azul",
    tamanho: "M",
    sku: id,
    ativo: true,
    disponivel,
    reservado: 0,
    emEstoque: disponivel,
    dono: null,
    minimo: 5,
    origemDoMinimo: "LOJA",
    custo: 10,
    atacado: 30,
    cadastradoEm: diasAtras(400).toISOString(),
    ...extra,
  });

  it("'o que repor' tem TODA peça no mínimo — a mesma conta do card, do sino e do Dashboard (dono externo e sugestão 0 inclusos)", () => {
    const linhas = [
      linha("a", 2), // no mínimo, nossa
      linha("b", 3, { dono: "NUVEMSHOP" }), // no mínimo, da Nuvemshop
      linha("c", 0, { minimo: 0 }), // mínimo 0, zerada, sem venda → sugestão 0
      linha("d", 40), // ok
    ];
    const p = resumirPainel(linhas, { porVariacao: new Map(), vendidasSemPeca: 0 }, hoje);
    expect(p.totais.noMinimo).toBe(3);
    expect(p.repor.map((l) => l.variantId).sort()).toEqual(["a", "b", "c"]);
    expect(p.repor.find((l) => l.variantId === "c")!.analise.repor).toBe(0);
  });

  it("giro % = vendidos ÷ (DISPONÍVEL + vendidos): a peça paga esperando envio já está em vendidos", () => {
    const linhas = [linha("a", 80, { reservado: 20, emEstoque: 100 })];
    const p = resumirPainel(
      linhas,
      { porVariacao: new Map([["a", { vendidos30: 20, ultimaVendaEm: diasAtras(1) }]]), vendidasSemPeca: 7 },
      hoje
    );
    expect(p.totais.giroPct).toBeCloseTo(20);
    expect(p.totais.vendidasSemPeca).toBe(7);
    expect(p.totais.valorCusto).toBe(100 * 10);
  });
});
