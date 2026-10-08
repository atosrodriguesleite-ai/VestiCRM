import { describe, it, expect } from "vitest";
import { agruparParaContagem, ehListaDeProducao, faltaParaOMinimo, recorteDaFolha, type LinhaDaFolha } from "../estoque/contagem";

/**
 * A FOLHA DE CONTAGEM DE ESTOQUE (pedido do dono, 28/09/2026): agrupa por
 * categoria e modelo, cores em ordem alfabética e tamanhos na ordem da
 * arara (pedido do dono, 05/10/2026), e soma o que o sistema espera
 * encontrar NA LOJA (disponível + reservado).
 */

const l = (x: Partial<LinhaDaFolha>): LinhaDaFolha => ({
  variantId: Math.random().toString(36),
  productId: "p1",
  produto: "Baby Look",
  categoria: "Blusas",
  cor: "Azul",
  tamanho: "P",
  sku: "BBL-AZ-P",
  emEstoque: 10,
  reservado: 0,
  disponivel: 10,
  minimo: 2,
  dono: null,
  ...x,
});

describe("folha de contagem", () => {
  it("agrupa por categoria (sem ligar para acento/caixa) e modelo, somando o que está na loja", () => {
    const g = agruparParaContagem([
      l({ categoria: "Vestidos", productId: "v1", produto: "Vestido Midi", emEstoque: 3 }),
      l({ categoria: "blusas", productId: "b1", produto: "Baby Look", tamanho: "P", emEstoque: 5 }),
      l({ categoria: "blusas", productId: "b1", produto: "Baby Look", tamanho: "M", emEstoque: 7, reservado: 2 }),
      l({ categoria: "Árvore", productId: "a1", produto: "Peça A", emEstoque: 1 }),
    ]);
    expect(g.map((c) => c.categoria)).toEqual(["Árvore", "blusas", "Vestidos"]);
    const blusas = g[1];
    expect(blusas.modelos).toHaveLength(1);
    expect(blusas.modelos[0].total).toBe(12);
    expect(blusas.total).toBe(12);
    expect(blusas.variacoes).toBe(2);
  });

  it("tamanhos na ordem da arara, mesmo que cheguem embaralhados", () => {
    const g = agruparParaContagem([
      l({ tamanho: "G" }),
      l({ tamanho: "PP" }),
      l({ tamanho: "M" }),
      l({ tamanho: "P" }),
    ]);
    expect(g[0].modelos[0].linhas.map((x) => x.tamanho)).toEqual(["PP", "P", "M", "G"]);
  });

  it("AS CORES DA CATEGORIA EM ORDEM ALFABÉTICA (05/10/2026): um produto por cor vira UM modelo, de A a Z", () => {
    // o print da Toque Leve: cinco produtos "Baby Look", um por cor, na ordem do cadastro
    const g = agruparParaContagem([
      l({ productId: "off", cor: "Off-white", tamanho: "P" }),
      l({ productId: "off", cor: "Off-white", tamanho: "M" }),
      l({ productId: "mar", cor: "Azul Marinho", tamanho: "P" }),
      l({ productId: "pre", cor: "Preto", tamanho: "GG" }),
      l({ productId: "pre", cor: "Preto", tamanho: "P" }),
      l({ productId: "ter", cor: "Terracota", tamanho: "P" }),
      l({ productId: "bra", cor: "Branco", tamanho: "P" }),
    ]);
    expect(g[0].modelos).toHaveLength(1);
    expect(g[0].modelos[0].produto).toBe("Baby Look");
    expect(g[0].modelos[0].linhas.map((x) => `${x.cor} ${x.tamanho}`)).toEqual([
      "Azul Marinho P",
      "Branco P",
      "Off-white P",
      "Off-white M",
      "Preto P",
      "Preto GG",
      "Terracota P",
    ]);
    expect(g[0].modelos[0].total).toBe(70);
    expect(g[0].variacoes).toBe(7);
  });

  it("nome igual com acento, caixa ou espaço diferente é o MESMO modelo; o total soma tudo", () => {
    const g = agruparParaContagem([
      l({ productId: "a", produto: "Regata Alça", cor: "Preto", emEstoque: 1 }),
      l({ productId: "b", produto: "regata alca ", cor: "Branco", emEstoque: 2 }),
    ]);
    expect(g[0].modelos).toHaveLength(1);
    expect(g[0].modelos[0].total).toBe(3);
    expect(g[0].modelos[0].linhas.map((x) => x.cor)).toEqual(["Branco", "Preto"]);
  });

  it("modelos de nome diferente ficam separados, em ordem alfabética (a do Inventário)", () => {
    const g = agruparParaContagem([
      l({ productId: "b", produto: "Top" }),
      l({ productId: "a", produto: "Regata" }),
      l({ productId: "a", produto: "Regata", tamanho: "M" }),
    ]);
    expect(g[0].modelos.map((m) => [m.produto, m.linhas.length])).toEqual([
      ["Regata", 2],
      ["Top", 1],
    ]);
  });

  it("o mesmo nome em categorias diferentes NÃO se junta (a folha anda categoria por categoria)", () => {
    const g = agruparParaContagem([
      l({ categoria: "Blusas", productId: "a", produto: "Básica" }),
      l({ categoria: "Vestidos", productId: "b", produto: "Básica" }),
    ]);
    expect(g.map((c) => [c.categoria, c.modelos.length])).toEqual([["Blusas", 1], ["Vestidos", 1]]);
  });

  it("categoria em branco vai para o fim, como 'Sem categoria'", () => {
    const g = agruparParaContagem([l({ categoria: " " , productId: "x"}), l({ categoria: "Zíper", productId: "z" })]);
    expect(g.map((c) => c.categoria)).toEqual(["Zíper", "Sem categoria"]);
  });

  it("sem peças, sem grupos", () => {
    expect(agruparParaContagem([])).toEqual([]);
  });

  it("o cabeçalho diz o recorte — ninguém acha que é a loja inteira", () => {
    expect(recorteDaFolha({})).toBe("Todas as categorias · só produtos ativos");
    expect(recorteDaFolha({ categoria: "Blusas", q: " azul ", inativos: true })).toBe(
      'Categoria: Blusas · busca "azul" · com produtos inativos'
    );
  });
});

describe("a folha segue o chip do Inventário e vira lista de produção (pedido do dono, 08/10/2026)", () => {
  it("'No mínimo' e 'Zeradas' são lista de produção; os outros chips seguem sendo contagem", () => {
    expect(ehListaDeProducao("baixo")).toBe(true);
    expect(ehListaDeProducao("zerado")).toBe(true);
    expect(ehListaDeProducao("reservado")).toBe(false);
    expect(ehListaDeProducao("todos")).toBe(false);
    expect(ehListaDeProducao(undefined)).toBe(false);
  });

  it("quanto falta é mínimo − disponível, nunca negativo", () => {
    expect(faltaParaOMinimo({ disponivel: 0, minimo: 5 })).toBe(5);
    expect(faltaParaOMinimo({ disponivel: 5, minimo: 5 })).toBe(0);
    expect(faltaParaOMinimo({ disponivel: 9, minimo: 5 })).toBe(0);
  });

  it("o cabeçalho diz qual chip recortou a folha", () => {
    expect(recorteDaFolha({ categoria: "Regata Alça", filtro: "baixo" })).toBe(
      'Categoria: Regata Alça · filtro "No mínimo" · só produtos ativos'
    );
    expect(recorteDaFolha({ filtro: "todos" })).toBe("Todas as categorias · só produtos ativos");
  });
});
