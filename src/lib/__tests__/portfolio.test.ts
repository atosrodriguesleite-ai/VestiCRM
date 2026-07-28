import { describe, it, expect } from "vitest";
import {
  totalPositions,
  resumoFinanceiro,
  precoVigente,
  precoLabel,
  categoriasEmUso,
  matchBusca,
} from "../portfolio";

describe("portfólio — posições alocadas", () => {
  it("soma horas e custo das posições", () => {
    const r = totalPositions([
      { hours: 8, cost: 1000 },
      { hours: 4.17, cost: 926.78 },
    ]);
    expect(r.hours).toBeCloseTo(12.17, 2);
    expect(r.cost).toBeCloseTo(1926.78, 2);
  });

  it("linha pela metade não quebra o total", () => {
    const r = totalPositions([
      { hours: 10, cost: null },
      { hours: undefined, cost: 500 },
      {},
    ]);
    expect(r.hours).toBe(10);
    expect(r.cost).toBe(500);
  });

  it("sem posições, total é zero", () => {
    expect(totalPositions([])).toEqual({ hours: 0, cost: 0 });
  });
});

describe("portfólio — resumo financeiro", () => {
  it("margem é o preço menos o custo de entrega", () => {
    const r = resumoFinanceiro(5497.14, [
      { hours: 74.17, cost: 1848.6 },
    ]);
    expect(r.custo).toBeCloseTo(1848.6, 2);
    expect(r.margem).toBeCloseTo(3648.54, 2);
    expect(r.margemPct).toBeCloseTo(66.37, 1);
  });

  it("sem preço definido não inventa margem negativa", () => {
    const r = resumoFinanceiro(null, [{ hours: 10, cost: 900 }]);
    expect(r.custo).toBe(900);
    expect(r.margem).toBeNull();
    expect(r.margemPct).toBeNull();
  });

  it("preço zero não divide por zero", () => {
    const r = resumoFinanceiro(0, [{ hours: 1, cost: 100 }]);
    expect(r.margem).toBe(-100);
    expect(r.margemPct).toBeNull();
  });

  it("custo maior que o preço aparece como prejuízo, não some", () => {
    const r = resumoFinanceiro(1000, [{ hours: 5, cost: 1500 }]);
    expect(r.margem).toBe(-500);
    expect(r.margemPct).toBeCloseTo(-50, 2);
  });
});

describe("portfólio — preço da variação", () => {
  const variants = [
    { name: "Basic", baseValue: 800 },
    { name: "E-commerce", baseValue: 1500 },
    { name: "Sob consulta", baseValue: null },
  ];

  it("quem manda no preço é a variação escolhida", () => {
    expect(precoVigente(500, variants, "E-commerce")).toBe(1500);
  });

  it("sem variação escolhida, vale o valor base", () => {
    expect(precoVigente(500, variants, null)).toBe(500);
  });

  it("variação sem preço próprio cai no valor base", () => {
    expect(precoVigente(500, variants, "Sob consulta")).toBe(500);
  });

  it("variação inexistente não zera o preço", () => {
    expect(precoVigente(500, variants, "Fantasma")).toBe(500);
  });

  it("sem preço nenhum, devolve nulo", () => {
    expect(precoVigente(null, [], null)).toBeNull();
  });
});

describe("portfólio — apoio de tela", () => {
  it("preço ausente vira 'A definir'", () => {
    expect(precoLabel(null)).toBe("A definir");
    expect(precoLabel(5497.14)).toContain("5.497,14");
  });

  it("categorias saem da própria base, sem repetir nem vazio", () => {
    expect(
      categoriasEmUso([
        { category: "Implantação" },
        { category: "Tráfego" },
        { category: "Implantação" },
        { category: "  " },
        { category: null },
      ])
    ).toEqual(["Implantação", "Tráfego"]);
  });

  it("busca ignora acento e caixa", () => {
    const p = { name: "Gestão de Mídia Paga", shortDesc: null, category: null };
    expect(matchBusca(p, "midia")).toBe(true);
    expect(matchBusca(p, "GESTAO")).toBe(true);
    expect(matchBusca(p, "costura")).toBe(false);
  });

  it("busca vazia mostra tudo", () => {
    const p = { name: "Qualquer", shortDesc: null, category: null };
    expect(matchBusca(p, "   ")).toBe(true);
  });

  it("busca acha pela categoria e pelo resumo", () => {
    const p = {
      name: "Combo Performance",
      shortDesc: "12 postagens por mês",
      category: "Social Media",
    };
    expect(matchBusca(p, "postagens")).toBe(true);
    expect(matchBusca(p, "social")).toBe(true);
  });
});
