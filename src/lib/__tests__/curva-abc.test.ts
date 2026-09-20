import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORTE_A, CORTE_B, lerBaseAbc, montarCurvaAbc, type ItemVendido } from "../tracking/curva-abc";
import { PAID_ORDER_STATUSES } from "../orders";

// BANCO SIMULADO para o guarda de comportamento da consulta (a régua da
// venda paga e o rateio do netTotal têm que valer no que vai ao banco, não
// só na função pura)
type Chamada = { modelo: string; args: Record<string, unknown> };
const chamadas: Chamada[] = [];
const banco = {
  orderItem: [] as Record<string, unknown>[],
  product: [] as { id: string; name: string; companyId: string }[],
  productVariant: [] as { id: string; color: string; size: string; companyId: string }[],
};
vi.mock("../db", () => ({
  db: {
    orderItem: {
      async findMany(args: Record<string, unknown>) {
        chamadas.push({ modelo: "orderItem", args });
        return banco.orderItem;
      },
    },
    product: {
      async findMany(args: { where: { id: { in: string[] }; companyId: string } }) {
        chamadas.push({ modelo: "product", args });
        return banco.product.filter((p) => args.where.id.in.includes(p.id) && p.companyId === args.where.companyId).map(({ id, name }) => ({ id, name }));
      },
    },
    productVariant: {
      async findMany(args: { where: { id: { in: string[] }; product: { companyId: string } } }) {
        chamadas.push({ modelo: "productVariant", args });
        return banco.productVariant
          .filter((v) => args.where.id.in.includes(v.id) && v.companyId === args.where.product.companyId)
          .map(({ id, color, size }) => ({ id, color, size }));
      },
    },
    trackEvent: { async findMany() { return []; } },
  },
}));

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
  productId: null,
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

  it("variação apagada e RECRIADA (grade refeita) é a MESMA peça: agrupa pelo produto + cor/tamanho", () => {
    // os itens antigos ficaram sem variantId (SetNull), os novos apontam para a
    // variação nova — a primeira versão (chave pela variação) mostrava duas
    // linhas da mesma peça, uma com o nome de hoje e outra com o congelado
    const { linhas } = montarCurvaAbc([
      item({ productId: "p1", variantId: null, nome: "Regata Alca", cor: "Preta", tamanho: "M", quantidade: 4, atual: { produto: "Regata Nadador" } }),
      item({ productId: "p1", variantId: "v-nova", nome: "Regata Alca", cor: "Preta", tamanho: "M", quantidade: 2, atual: { produto: "Regata Nadador", cor: "Preta", tamanho: "M" } }),
      item({ productId: "p1", variantId: "v-g", nome: "Regata Alca", cor: "Preta", tamanho: "G", quantidade: 1, atual: { produto: "Regata Nadador", cor: "Preta", tamanho: "G" } }),
    ]);
    expect(linhas.map((l) => [l.rotulo, l.unidades])).toEqual([
      ["Regata Nadador · Preta · M", 6],
      ["Regata Nadador · Preta · G", 1],
    ]);
    // produtos DIFERENTES com a mesma cor e tamanho continuam separados
    const r = montarCurvaAbc([
      item({ productId: "p1", quantidade: 1, atual: { produto: "Regata" } }),
      item({ productId: "p2", quantidade: 1, atual: { produto: "Regata" } }),
    ]);
    expect(r.linhas).toHaveLength(2);
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

  it("o resumo A + B + C fecha EXATAMENTE com o total — a sobra do centavo vai para a última classe com peça", () => {
    // valores com meio centavo em todas as linhas: somar as linhas já
    // arredondadas divergia do total por centavos (achado da revisão)
    const itens = Array.from({ length: 40 }, (_, i) => item({ variantId: `v${i}`, quantidade: 40 - i, valorVendido: 10.005 + i * 0.001 }));
    for (const base of ["unidades", "faturamento"] as const) {
      const { resumo, totalFaturamento, linhas } = montarCurvaAbc(itens, base);
      expect(r2(resumo.A.faturamento + resumo.B.faturamento + resumo.C.faturamento)).toBe(totalFaturamento);
      expect(resumo.A.unidades + resumo.B.unidades + resumo.C.unidades).toBe(linhas.reduce((s, l) => s + l.unidades, 0));
      expect(resumo.A.itens + resumo.B.itens + resumo.C.itens).toBe(linhas.length);
    }
    // classe vazia fica em zero (a sobra nunca cai numa classe sem peça)
    const um = montarCurvaAbc([item({ variantId: "a", quantidade: 1, valorVendido: 10.005 })]);
    expect(um.resumo.A.faturamento).toBe(um.totalFaturamento);
    expect(um.resumo.B.faturamento).toBe(0);
    expect(um.resumo.C.faturamento).toBe(0);
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

const r2 = (n: number) => Math.round(n * 100) / 100;

describe("RN-061: a consulta usa a MESMA régua dos outros quadros (banco simulado)", () => {
  const periodo = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") };
  beforeEach(() => {
    chamadas.length = 0;
    banco.orderItem = [
      // item de R$ 50 num pedido de subtotal 100 que vendeu por 80 (desconto): vale 40
      { productId: "p1", variantId: "v1", name: "Regata Alca", color: "preto", size: "M", quantity: 5, total: 50, order: { subtotal: 100, netTotal: 80 } },
      // a variação antiga foi apagada (SetNull) e o produto ficou: é a MESMA peça
      { productId: "p1", variantId: null, name: "Regata Alca", color: "Preta", size: "M", quantity: 1, total: 10, order: { subtotal: 10, netTotal: 10 } },
      // peça de produto apagado: nome congelado
      { productId: null, variantId: null, name: "Blusa Antiga", color: "Azul", size: "P", quantity: 2, total: 20, order: { subtotal: 20, netTotal: 20 } },
    ];
    banco.product = [{ id: "p1", name: "Regata Nadador", companyId: "loja" }, { id: "p1", name: "Regata de OUTRA loja", companyId: "outra" }];
    banco.productVariant = [{ id: "v1", color: "Preta", size: "M", companyId: "loja" }];
  });

  it("só pedido pago (RN-001) pela data do pagamento, valor pela fatia do netTotal (RN-002), rótulo do cadastro de hoje", async () => {
    const { curvaAbcStats } = await import("../tracking/insights");
    const abc = await curvaAbcStats("loja", periodo);
    const consulta = chamadas.find((c) => c.modelo === "orderItem")!.args as { where: { order: Record<string, unknown> } };
    expect(consulta.where.order).toMatchObject({
      companyId: "loja",
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { gte: periodo.from, lte: periodo.to },
    });
    expect(abc.linhas.map((l) => [l.rotulo, l.unidades, l.faturamento])).toEqual([
      ["Regata Nadador · Preta · M", 6, 50], // 40 (rateado) + 10, UMA linha apesar da variação apagada
      ["Blusa Antiga · Azul · P", 2, 20],
    ]);
    expect(abc.totalFaturamento).toBe(70);
    // o cadastro é lido recortado pela loja (RN-013): o "p1" da outra loja não rotula nada
    const cadastro = chamadas.find((c) => c.modelo === "product")!.args as { where: { companyId: string } };
    expect(cadastro.where.companyId).toBe("loja");
    expect((chamadas.find((c) => c.modelo === "productVariant")!.args as { where: { product: { companyId: string } } }).where.product.companyId).toBe("loja");
  });

  it("os itens pré-carregados pela tela são reaproveitados — a curva não varre a tabela de novo", async () => {
    const { curvaAbcStats, itensVendidosNoPeriodo, colorStats } = await import("../tracking/insights");
    const itens = itensVendidosNoPeriodo("loja", periodo);
    const [abc, cores] = await Promise.all([curvaAbcStats("loja", periodo, "unidades", itens), colorStats("loja", periodo, itens)]);
    expect(chamadas.filter((c) => c.modelo === "orderItem")).toHaveLength(1);
    // e os dois quadros contam as MESMAS unidades
    expect(cores.reduce((s, c) => s + c.sold, 0)).toBe(abc.totalUnidades);
  });

  it("a tela e o CSV obedecem o período e a base escolhidos", () => {
    const tela = ler("src/app/(app)/inteligencia/page.tsx");
    // a tela monta a curva nas DUAS bases sobre os MESMOS itens do período
    expect(tela).toContain("itensParaCurvaAbc(c, period, itensDoPeriodo)");
    expect(tela).toContain('montarCurvaAbc(itensAbc, "unidades")');
    expect(tela).toContain('montarCurvaAbc(itensAbc, "faturamento")');
    // o cabeçalho da coluna de % muda com a base (por faturamento não é "% un.")
    expect(ler("src/app/(app)/inteligencia/curva-abc-view.tsx")).toContain('base === "unidades" ? "% un." : "% R$"');
    // trocar o período (atalhos, Limpar e o formulário) não devolve a curva ao padrão
    expect(tela).toContain("href={`/inteligencia?dias=${p.d}${estadoAbc}`}");
    expect(tela).toContain("href={`/inteligencia?dias=30${estadoAbc}`}");
    expect(tela).toContain('<input type="hidden" name="abc" value={baseAbc} />');
    expect(ler("src/app/api/intelligence/export/route.ts")).toContain('case "abc"');
  });
});

describe("RN-061: navegar pela curva sem recarregar (filtro por classe e busca)", () => {
  it("filtrar mantém a POSIÇÃO da peça na curva inteira e a busca ignora acento e caixa", async () => {
    const { filtrarLinhas } = await import("../../app/(app)/inteligencia/curva-abc-view");
    const { linhas } = montarCurvaAbc(
      [
        item({ variantId: "a", nome: "Regata Alça", cor: "Preta", tamanho: "M", quantidade: 70 }),
        item({ variantId: "b", nome: "Regata Quadrada", cor: "Café", tamanho: "G", quantidade: 20 }),
        item({ variantId: "c", nome: "Blusa", cor: "Azul", tamanho: "P", quantidade: 6 }),
        item({ variantId: "d", nome: "Blusa", cor: "Azul", tamanho: "M", quantidade: 4 }),
      ]
    );
    expect(linhas.map((l) => l.classe)).toEqual(["A", "A", "B", "C"]);
    expect(filtrarLinhas(linhas, "todas", "").map((x) => x.posicao)).toEqual([1, 2, 3, 4]);
    // a 3ª peça que mais vende continua sendo a 3ª quando se olha só a classe B
    expect(filtrarLinhas(linhas, "B", "").map((x) => [x.posicao, x.linha.rotulo])).toEqual([[3, "Blusa · Azul · P"]]);
    expect(filtrarLinhas(linhas, "A", "cafe").map((x) => x.linha.rotulo)).toEqual(["Regata Quadrada · Café · G"]);
    expect(filtrarLinhas(linhas, "todas", "ALÇA preta").map((x) => x.posicao)).toEqual([1]);
    expect(filtrarLinhas(linhas, "C", "regata")).toEqual([]);
  });
});
