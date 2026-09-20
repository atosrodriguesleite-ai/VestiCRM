import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORTE_A, CORTE_B, lerBaseAbc, montarCurvaAbc, type ItemVendido } from "../tracking/curva-abc";

// Guarda RN-061
/**
 * RN-061 — CURVA ABC POR PEÇA na Inteligência: cada linha é a variação exata
 * (produto × cor × tamanho), em UNIDADES, com a classe A/B/C pelo acumulado
 * (80% / 95%) da base escolhida, obedecendo o período da tela.
 */
const raiz = process.cwd();
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const item = (over: Partial<ItemVendido>): ItemVendido => ({
  variantId: null,
  nome: "Regata Alça",
  cor: "Preta",
  tamanho: "M",
  quantidade: 1,
  valorVendido: 10,
  ...over,
});

describe("RN-061: a linha é a PEÇA exata", () => {
  it("agrupa por variação e rotula 'Produto · Cor · Tamanho' com o cadastro de hoje", () => {
    const v1 = { produto: "Regata Alça", cor: "Preta", tamanho: "M" };
    const v2 = { produto: "Regata Alça", cor: "Preta", tamanho: "G" };
    const { linhas } = montarCurvaAbc([
      item({ variantId: "v1", nome: "Regata Alca", cor: "preto", tamanho: "m", quantidade: 3, atual: v1 }),
      item({ variantId: "v1", quantidade: 2, valorVendido: 20, atual: v1 }),
      item({ variantId: "v2", tamanho: "G", quantidade: 1, atual: v2 }),
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ rotulo: "Regata Alça · Preta · M", unidades: 5, faturamento: 30 });
    expect(linhas[1]).toMatchObject({ rotulo: "Regata Alça · Preta · G", unidades: 1 });
  });

  it("peça apagada do cadastro (sem variação) agrupa pelo nome congelado, sem xará invisível", () => {
    const { linhas } = montarCurvaAbc([
      item({ nome: "Regata Alça ", cor: "Preta", tamanho: "M", quantidade: 2 }),
      item({ nome: "regata alça", cor: "preta ", tamanho: "m", quantidade: 1 }),
      item({ nome: "Regata Alça", cor: null, tamanho: null, quantidade: 1 }),
    ]);
    expect(linhas.map((l) => [l.rotulo, l.unidades])).toEqual([
      ["Regata Alça · Preta · M", 3],
      ["Regata Alça · Sem cor · Sem tamanho", 1],
    ]);
  });

  it("quantidade zero ou negativa não vira linha", () => {
    expect(montarCurvaAbc([item({ quantidade: 0 }), item({ quantidade: -2 })]).linhas).toEqual([]);
  });
});

describe("RN-061: a classe pelo acumulado", () => {
  // 10 peças: 60, 20, 10, 5, 3, 1, 1 (total 100)
  const itens = [60, 20, 10, 5, 3, 1, 1].map((q, i) => item({ variantId: `v${i}`, quantidade: q, valorVendido: q }));

  it("a peça que faz a curva CRUZAR os 80% ainda é A (campeã com 90% sozinha não pode ficar sem classe A)", () => {
    const { linhas } = montarCurvaAbc([item({ variantId: "campea", quantidade: 90 }), item({ variantId: "resto", quantidade: 10 })]);
    expect(linhas.map((l) => l.classe)).toEqual(["A", "B"]);
    // 70 + 20 = 90: a segunda cruza os 80 e ainda é A; a terceira começa em 90 → B
    const r = montarCurvaAbc([70, 20, 6, 4].map((q, i) => item({ variantId: `v${i}`, quantidade: q })));
    expect(r.linhas.map((l) => l.classe)).toEqual(["A", "A", "B", "C"]);
  });

  it("A fecha 80%, B vai até 95%, C é o resto — pela ordem do que mais vende", () => {
    const { linhas, resumo, totalUnidades } = montarCurvaAbc(itens);
    expect(totalUnidades).toBe(100);
    expect(linhas.map((l) => l.unidades)).toEqual([60, 20, 10, 5, 3, 1, 1]);
    expect(linhas.map((l) => l.acumulado)).toEqual([60, 80, 90, 95, 98, 99, 100]);
    expect(linhas.map((l) => l.classe)).toEqual(["A", "A", "B", "B", "C", "C", "C"]);
    expect(resumo.A).toMatchObject({ itens: 2, unidades: 80, parteBase: 80 });
    expect(resumo.B).toMatchObject({ itens: 2, unidades: 15, parteBase: 15 });
    expect(resumo.C).toMatchObject({ itens: 3, unidades: 5, parteBase: 5 });
    expect(CORTE_A).toBe(80);
    expect(CORTE_B).toBe(95);
  });

  it("por FATURAMENTO a ordem e a classe podem mudar — a peça barata que vende muito cai de A para B", () => {
    const { linhas } = montarCurvaAbc(
      [
        item({ variantId: "barata", quantidade: 50, valorVendido: 100 }),
        item({ variantId: "cara", quantidade: 5, valorVendido: 900 }),
      ],
      "faturamento"
    );
    expect(linhas.map((l) => l.chave)).toEqual(["v:cara", "v:barata"]);
    expect(linhas.map((l) => l.classe)).toEqual(["A", "B"]);
    expect(linhas[0].parte).toBe(90);
  });

  it("empate desempata pela outra medida e depois pelo nome (ordem estável)", () => {
    const { linhas } = montarCurvaAbc([
      item({ variantId: "b", nome: "B", quantidade: 5, valorVendido: 10 }),
      item({ variantId: "a", nome: "A", quantidade: 5, valorVendido: 10 }),
      item({ variantId: "c", nome: "C", quantidade: 5, valorVendido: 50 }),
    ]);
    expect(linhas.map((l) => l.produto)).toEqual(["C", "A", "B"]);
  });

  it("na BORDA, quem cruza os 80% é A — sem arredondar 79,995 para 80", () => {
    const { linhas } = montarCurvaAbc([79995, 20004, 1].map((q, i) => item({ variantId: `v${i}`, quantidade: q })));
    expect(linhas.map((l) => l.classe)).toEqual(["A", "A", "C"]);
    // e quem começa exatamente em 95 é C
    const r = montarCurvaAbc([95, 5].map((q, i) => item({ variantId: `v${i}`, quantidade: q })));
    expect(r.linhas.map((l) => l.classe)).toEqual(["A", "C"]);
  });

  it("sem base (todo mundo faturou zero) ninguém é A — tudo C, e a tela não inventa 'quem carrega a loja'", () => {
    const { linhas, resumo } = montarCurvaAbc(
      [item({ variantId: "a", quantidade: 5, valorVendido: 0 }), item({ variantId: "b", quantidade: 3, valorVendido: 0 })],
      "faturamento"
    );
    expect(linhas.map((l) => l.classe)).toEqual(["C", "C"]);
    expect(resumo.A.itens).toBe(0);
    expect(resumo.C).toMatchObject({ itens: 2, parteBase: 0 });
  });

  it("rateio NEGATIVO (desconto acima do subtotal) não entra: o acumulado não passa de 100 escondido", () => {
    const { linhas, totalFaturamento } = montarCurvaAbc(
      [
        item({ variantId: "a", quantidade: 1, valorVendido: 100 }),
        item({ variantId: "b", quantidade: 1, valorVendido: -20 }),
        item({ variantId: "c", quantidade: 1, valorVendido: 30 }),
      ],
      "faturamento"
    );
    expect(totalFaturamento).toBe(130);
    expect(linhas.map((l) => l.acumulado)).toEqual([76.92, 100, 100]);
    expect(linhas.every((l) => l.parte >= 0)).toBe(true);
  });

  it("acumulado nunca passa de 100 por arredondamento", () => {
    const { linhas } = montarCurvaAbc([1, 1, 1].map((q, i) => item({ variantId: `v${i}`, quantidade: q })));
    expect(linhas.at(-1)?.acumulado).toBe(100);
    expect(linhas.every((l) => l.acumulado <= 100)).toBe(true);
  });

  it("a base da URL cai em unidades por padrão", () => {
    expect(lerBaseAbc(undefined)).toBe("unidades");
    expect(lerBaseAbc("faturamento")).toBe("faturamento");
    expect(lerBaseAbc("xyz")).toBe("unidades");
  });
});

describe("RN-061: a consulta usa a MESMA régua dos outros quadros", () => {
  it("só pedido pago (RN-001) pela data do pagamento, valor pela fatia do netTotal (RN-002)", () => {
    const src = ler("src/lib/tracking/insights.ts");
    const fn = src.slice(src.indexOf("export async function curvaAbcStats"), src.indexOf("export const productStats"));
    expect(fn).toContain("status: { in: PAID_ORDER_STATUSES }");
    expect(fn).toContain("paidAt: { gte: p.from, lte: p.to }");
    expect(fn).toContain("valorVendidoDoItem(it.total, it.order.subtotal, it.order.netTotal)");
    // a tela e o CSV obedecem o período e a base escolhidos
    const tela = ler("src/app/(app)/inteligencia/page.tsx");
    expect(tela).toContain("curvaAbcStats(c, period, baseAbc)");
    // o cabeçalho da coluna de % muda com a base (por faturamento não é "% un.")
    expect(tela).toContain('baseAbc === "unidades" ? "% un." : "% R$"');
    expect(ler("src/app/api/intelligence/export/route.ts")).toContain('case "abc"');
  });
});
