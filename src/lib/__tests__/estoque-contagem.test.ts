import { describe, it, expect } from "vitest";
import { agruparParaContagem, recorteDaFolha, type LinhaDaFolha } from "../estoque/contagem";

/**
 * A FOLHA DE CONTAGEM DE ESTOQUE (pedido do dono, 28/09/2026): agrupa por
 * categoria e modelo, na ordem da arara, e soma o que o sistema espera
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

  it("preserva a ordem das linhas (a da arara, a mesma do Inventário)", () => {
    const g = agruparParaContagem([
      l({ tamanho: "PP" }),
      l({ tamanho: "P" }),
      l({ tamanho: "M" }),
      l({ tamanho: "G" }),
    ]);
    expect(g[0].modelos[0].linhas.map((x) => x.tamanho)).toEqual(["PP", "P", "M", "G"]);
  });

  it("modelos da mesma categoria ficam separados, na ordem em que chegam", () => {
    const g = agruparParaContagem([
      l({ productId: "a", produto: "Regata" }),
      l({ productId: "b", produto: "Top" }),
      l({ productId: "a", produto: "Regata", tamanho: "M" }),
    ]);
    expect(g[0].modelos.map((m) => [m.produto, m.linhas.length])).toEqual([
      ["Regata", 2],
      ["Top", 1],
    ]);
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
