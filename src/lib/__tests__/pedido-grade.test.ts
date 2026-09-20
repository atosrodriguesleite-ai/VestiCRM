import { describe, it, expect } from "vitest";
import {
  agruparPorProduto,
  aplicarGradeNoPedido,
  aplicarPrecoNoProduto,
  chaveDaCelula,
  montarGrade,
  pecasAcimaDoEstoque,
  pecasNoPedido,
  precoDoCabecalho,
  quantidadeDigitada,
  quantidadesNoPedido,
  repetirNaLinha,
  resumoDaGrade,
  SEM_COR,
  SEM_TAMANHO,
  type LinhaDoPedido,
  type VariacaoDaGrade,
} from "../pedido-grade";

// Guarda RN-062
/**
 * RN-062 — MONTAR PEDIDO PELA GRADE (cor × tamanho): a grade abre com o que
 * já está no pedido e SUBSTITUI aquela peça (não soma), preço editado à mão
 * nunca é reescrito, célula zerada sai, a ordem do pedido é preservada e a
 * quantidade PARA no estoque — a porta de criação recusa o pedido inteiro
 * quando falta peça, então a tela não oferece o que o servidor recusa.
 */

const v = (id: string, color: string | null, size: string | null, stock = 10): VariacaoDaGrade => ({
  id,
  color,
  size,
  stock,
});

const linha = (over: Partial<LinhaDoPedido>): LinhaDoPedido => ({
  productId: "p1",
  variantId: "v1",
  name: "Baby Look",
  color: "Preta",
  size: "M",
  quantity: 1,
  unitPrice: 34,
  stock: 10,
  ...over,
});

describe("RN-062: a grade é cor × tamanho, na ordem da arara", () => {
  it("cor vira linha (alfabética) e tamanho vira coluna (PP < P < M < G), nunca o alfabeto", () => {
    const grade = montarGrade([
      v("a", "Preta", "G"),
      v("b", "Café", "M"),
      v("c", "Preta", "PP"),
      v("d", "Café", "G"),
      v("e", "Preta", "M"),
    ]);
    expect(grade.cores).toEqual(["Café", "Preta"]);
    expect(grade.tamanhos).toEqual(["PP", "M", "G"]);
    expect(grade.celulas.get(chaveDaCelula("Preta", "PP"))?.id).toBe("c");
    // cruzamento que a loja NÃO cadastrou fica vazio: não é zero, é "não existe"
    expect(grade.celulas.get(chaveDaCelula("Café", "PP"))).toBeUndefined();
  });

  it("peça sem cor ou sem tamanho ganha rótulo, e não uma célula em branco", () => {
    const grade = montarGrade([v("a", null, null), v("b", "", "  ")]);
    expect(grade.cores).toEqual([SEM_COR]);
    expect(grade.tamanhos).toEqual([SEM_TAMANHO]);
    // cadastro duplicado (mesma cor e tamanho) é UMA célula, a primeira
    expect(grade.celulas.get(chaveDaCelula(SEM_COR, SEM_TAMANHO))?.id).toBe("a");
  });
});

describe("RN-062: a grade abre com o que já está no pedido", () => {
  const linhas = [
    linha({ variantId: "v1", color: "Preta", size: "M", quantity: 3 }),
    linha({ variantId: "v2", color: "Preta", size: "G", quantity: 2 }),
    linha({ productId: "p2", variantId: "z9", name: "Regata", quantity: 7 }),
  ];

  it("diz a quantidade de cada variação daquela peça e o total dela no pedido", () => {
    expect([...quantidadesNoPedido(linhas, "p1")]).toEqual([
      ["v1", 3],
      ["v2", 2],
    ]);
    expect(pecasNoPedido(linhas, "p1")).toBe(5);
    expect(pecasNoPedido(linhas, "p2")).toBe(7);
    expect(pecasNoPedido(linhas, "nao-existe")).toBe(0);
  });
});

describe("RN-062: aplicar a grade no pedido", () => {
  const produto = { id: "p1", name: "Baby Look" };
  const variantes = [v("v1", "Preta", "M"), v("v2", "Preta", "G"), v("v3", "Café", "M")];
  const preco = () => 34;

  it("SUBSTITUI o que era daquela peça — abrir e confirmar não dobra a quantidade", () => {
    const antes = [linha({ variantId: "v1", quantity: 3 })];
    const depois = aplicarGradeNoPedido(antes, produto, variantes, new Map([["v1", 3]]), preco);
    expect(depois.map((l) => [l.variantId, l.quantity])).toEqual([["v1", 3]]);
  });

  it("preço editado à MÃO não é reescrito; só célula nova nasce com o preço sugerido", () => {
    const antes = [linha({ variantId: "v1", quantity: 3, unitPrice: 30 })]; // desconto combinado
    const depois = aplicarGradeNoPedido(
      antes,
      produto,
      variantes,
      new Map([
        ["v1", 5],
        ["v3", 2],
      ]),
      preco
    );
    expect(depois.map((l) => [l.variantId, l.quantity, l.unitPrice])).toEqual([
      ["v1", 5, 30],
      ["v3", 2, 34],
    ]);
  });

  it("onde o preço NÃO é editável (Central), a linha que cresce recalcula pela escada do atacado", () => {
    // unitPriceFor de verdade: vira atacado a partir do mínimo do modelo
    const escada = (q: number) => (q >= 5 ? 30 : 40);
    const antes = [linha({ variantId: "v1", quantity: 2, unitPrice: 40 })];
    const depois = aplicarGradeNoPedido(antes, produto, variantes, new Map([["v1", 6]]), escada, "recalcular");
    expect(depois.map((l) => [l.quantity, l.unitPrice])).toEqual([[6, 30]]);
    // e o padrão continua sendo PRESERVAR: na tela de Pedidos o preço é digitado
    const preservado = aplicarGradeNoPedido(antes, produto, variantes, new Map([["v1", 6]]), escada);
    expect(preservado.map((l) => [l.quantity, l.unitPrice])).toEqual([[6, 40]]);
  });

  it("célula zerada SAI do pedido e as outras peças ficam intocadas, na mesma ordem", () => {
    const antes = [
      linha({ productId: "p0", variantId: "a", name: "Antes" }),
      linha({ variantId: "v1", quantity: 3 }),
      linha({ variantId: "v2", quantity: 2 }),
      linha({ productId: "p2", variantId: "z", name: "Depois" }),
    ];
    const depois = aplicarGradeNoPedido(antes, produto, variantes, new Map([["v2", 4]]), preco);
    expect(depois.map((l) => l.variantId)).toEqual(["a", "v2", "z"]);
    expect(depois.find((l) => l.variantId === "v2")?.quantity).toBe(4);
  });

  it("a linha que fica segue no LUGAR dela e a nova entra no fim (a lista não se reorganiza)", () => {
    const antes = [linha({ variantId: "v2", quantity: 2 }), linha({ variantId: "v1", quantity: 1 })];
    const depois = aplicarGradeNoPedido(
      antes,
      produto,
      variantes,
      new Map([
        ["v1", 1],
        ["v2", 2],
        ["v3", 9],
      ]),
      preco
    );
    expect(depois.map((l) => l.variantId)).toEqual(["v2", "v1", "v3"]);
  });

  it("quantidade quebrada ou negativa não entra (o que vale é peça inteira)", () => {
    const depois = aplicarGradeNoPedido(
      [],
      produto,
      variantes,
      new Map([
        ["v1", 2.7],
        ["v2", -3],
      ]),
      preco
    );
    expect(depois.map((l) => [l.variantId, l.quantity])).toEqual([["v1", 2]]);
  });

  it("o estoque da linha acompanha a leitura mais nova do servidor", () => {
    const antes = [linha({ variantId: "v1", quantity: 1, stock: 99 })];
    const depois = aplicarGradeNoPedido(antes, produto, [v("v1", "Preta", "M", 4)], new Map([["v1", 1]]), preco);
    expect(depois[0].stock).toBe(4);
  });

  it("o preço sugerido recebe a quantidade DAQUELA célula (a régua de atacado de quem chama)", () => {
    const porQuantidade = (q: number) => (q >= 5 ? 30 : 40);
    const depois = aplicarGradeNoPedido(
      [],
      produto,
      variantes,
      new Map([
        ["v1", 6],
        ["v2", 1],
      ]),
      porQuantidade
    );
    expect(depois.map((l) => l.unitPrice)).toEqual([30, 40]);
  });
});

describe("RN-062: o resumo do que está preenchido", () => {
  it("soma peças, variações e valor pela régua de preço de quem chama", () => {
    const r = resumoDaGrade(
      new Map([
        ["v1", 3],
        ["v2", 2],
        ["v3", 0],
      ]),
      () => 34
    );
    expect(r).toEqual({ pecas: 5, variacoes: 2, valor: 170 });
  });

  it("grade vazia é zero em tudo (o botão de adicionar fica desligado)", () => {
    expect(resumoDaGrade(new Map(), () => 34)).toEqual({ pecas: 0, variacoes: 0, valor: 0 });
  });
});

describe("RN-062: o cabeçalho da grade não promete preço que as células não cobram", () => {
  // escada de atacado de verdade: a partir de 6 peças NA LINHA sai a 30
  const escada = (q: number) => (q >= 6 ? 30 : 40);

  it("grade vazia mostra o preço de UMA peça (o 'a partir de')", () => {
    expect(precoDoCabecalho(new Map(), escada)).toEqual({ min: 40, max: 40 });
  });

  it("2+2+2 com mínimo 6 é VAREJO nas três linhas — somar seis peças não vira atacado", () => {
    const q = new Map([["a", 2], ["b", 2], ["c", 2]]);
    expect(precoDoCabecalho(q, escada)).toEqual({ min: 40, max: 40 });
    // e o total bate com o que as células cobram
    expect(resumoDaGrade(q, escada)).toMatchObject({ pecas: 6, valor: 240 });
  });

  it("células com preços diferentes viram FAIXA, nunca um número só", () => {
    expect(precoDoCabecalho(new Map([["a", 8], ["b", 2]]), escada)).toEqual({ min: 30, max: 40 });
  });

  it("onde o preço não depende da quantidade (tela Pedidos), é sempre o mesmo número", () => {
    expect(precoDoCabecalho(new Map([["a", 1], ["b", 90]]), () => 34)).toEqual({ min: 34, max: 34 });
  });
});

describe("RN-062: a conferência é por PEÇA, não por cor × tamanho", () => {
  it("agrupa por produto somando peças e valor, e diz o preço quando ele é o mesmo", () => {
    const grupos = agruparPorProduto([
      linha({ variantId: "v1", quantity: 3, unitPrice: 34 }),
      linha({ variantId: "v2", quantity: 2, unitPrice: 34 }),
      linha({ productId: "p2", variantId: "z", name: "Regata", quantity: 1, unitPrice: 50 }),
    ]);
    expect(grupos.map((g) => [g.name, g.pecas, g.valor, g.precoUnico])).toEqual([
      ["Baby Look", 5, 170, 34],
      ["Regata", 1, 50, 50],
    ]);
  });

  it("preço diferente entre as variações do mesmo modelo é DITO, não escondido num número qualquer", () => {
    const grupos = agruparPorProduto([
      linha({ variantId: "v1", quantity: 1, unitPrice: 34 }),
      linha({ variantId: "v2", quantity: 1, unitPrice: 30 }),
    ]);
    expect(grupos[0].precoUnico).toBeNull();
    expect(grupos[0].valor).toBe(64);
  });

  it("mudar o preço do modelo troca TODAS as variações dele, e só dele", () => {
    const depois = aplicarPrecoNoProduto(
      [linha({ variantId: "v1" }), linha({ variantId: "v2" }), linha({ productId: "p2", variantId: "z" })],
      "p1",
      29.9
    );
    expect(depois.map((l) => l.unitPrice)).toEqual([29.9, 29.9, 34]);
    // preço negativo não existe (a tela digitada não vira desconto escondido)
    expect(aplicarPrecoNoProduto([linha({})], "p1", -5)[0].unitPrice).toBe(0);
  });
});

describe("RN-062: a quantidade PARA no estoque", () => {
  it("o que se digita na célula nunca passa do que há na arara (o servidor recusaria o pedido inteiro)", () => {
    expect(quantidadeDigitada("12", 2)).toBe("2");
    expect(quantidadeDigitada("2", 10)).toBe("2");
    expect(quantidadeDigitada("", 10)).toBe("");
    expect(quantidadeDigitada("0", 10)).toBe("0");
    // sem estoque não entra nada, nem por teclado
    expect(quantidadeDigitada("5", 0)).toBe("0");
    // letras, sinal e zero à esquerda não viram quantidade
    expect(quantidadeDigitada("-3a", 10)).toBe("3");
    expect(quantidadeDigitada("007", 10)).toBe("7");
    // número absurdo colado não estoura o campo
    expect(quantidadeDigitada("999999", 500)).toBe("500");
  });

  it("'repetir' preenche só as células VAZIAS da cor — nunca apaga o que já foi digitado", () => {
    const celulas = [v("p", "Preta", "P", 10), v("m", "Preta", "M", 10), v("g", "Preta", "G", 3)];
    // começou com P=3 e M=5: o M fica como está, o G entra com 3 (limitado a 3)
    expect(repetirNaLinha({ p: "3", m: "5" }, celulas)).toEqual({ p: "3", m: "5", g: "3" });
    // linha vazia não tem o que repetir
    expect(repetirNaLinha({}, celulas)).toEqual({});
    // cor sem estoque não é preenchida
    expect(repetirNaLinha({ p: "4" }, [v("p", "Preta", "P", 10), v("z", "Preta", "GG", 0)])).toEqual({ p: "4" });
  });

  it("lista as peças que ficaram acima do estoque (alguém vendeu enquanto o pedido era montado)", () => {
    const acima = pecasAcimaDoEstoque([
      linha({ variantId: "v1", quantity: 12, stock: 10 }),
      linha({ variantId: "v2", quantity: 10, stock: 10 }),
      linha({ variantId: "v3", quantity: 1, stock: 0 }),
    ]);
    expect(acima.map((l) => l.variantId)).toEqual(["v1", "v3"]);
  });
});
