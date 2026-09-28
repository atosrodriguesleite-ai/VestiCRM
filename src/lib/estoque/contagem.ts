import type { DonoExterno } from "./dono-do-estoque";

/**
 * FOLHA DE CONTAGEM DE ESTOQUE (pedido do dono, 28/09/2026: *"uma opção de
 * imprimir uma folha com todas as peças, tamanhos e cores para fazer
 * contagem de estoque"*).
 *
 * A folha é para a ARARA: quem conta anda categoria por categoria, então
 * ela sai agrupada por CATEGORIA e, dentro dela, por MODELO, com as cores e
 * tamanhos na ordem da tela (a mesma ordem do Inventário filtrado pela
 * categoria — é lá que a contagem volta a ser digitada, linha a linha).
 *
 * O número de comparação é o NA LOJA (disponível + reservado): a peça
 * separada para um pedido ainda está fisicamente na loja e entra na
 * contagem. Por isso a folha mostra também o reservado — no Inventário o
 * número que se digita é o DISPONÍVEL (contado − reservado).
 *
 * Regra pura; a leitura mora em `linhasDaContagem` (inventario.ts).
 */

export type LinhaDaFolha = {
  variantId: string;
  productId: string;
  produto: string;
  categoria: string;
  cor: string;
  tamanho: string;
  sku: string;
  emEstoque: number;
  reservado: number;
  dono: DonoExterno | null;
};

export type ModeloDaFolha = {
  productId: string;
  produto: string;
  linhas: LinhaDaFolha[];
  /** peças na loja do modelo inteiro (a soma das linhas) */
  total: number;
};

export type CategoriaDaFolha = {
  categoria: string;
  modelos: ModeloDaFolha[];
  total: number;
  variacoes: number;
};

/**
 * Agrupa por categoria (ordem alfabética, sem ligar para acento e caixa) e
 * por modelo, PRESERVANDO a ordem das linhas que chegam (nome do produto e,
 * dentro dele, cor × tamanho na ordem da arara — `ordenarVariantes`).
 * Categoria em branco vai para o fim, como "Sem categoria".
 */
export function agruparParaContagem(linhas: LinhaDaFolha[]): CategoriaDaFolha[] {
  const porCategoria = new Map<string, Map<string, ModeloDaFolha>>();
  for (const l of linhas) {
    const cat = l.categoria.trim() || "Sem categoria";
    const modelos = porCategoria.get(cat) ?? new Map<string, ModeloDaFolha>();
    porCategoria.set(cat, modelos);
    const m = modelos.get(l.productId) ?? { productId: l.productId, produto: l.produto, linhas: [], total: 0 };
    modelos.set(l.productId, m);
    m.linhas.push(l);
    m.total += l.emEstoque;
  }
  const comparar = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare;
  return [...porCategoria.entries()]
    .sort(([a], [b]) => {
      if (a === "Sem categoria") return 1;
      if (b === "Sem categoria") return -1;
      return comparar(a, b);
    })
    .map(([categoria, modelos]) => {
      const lista = [...modelos.values()];
      return {
        categoria,
        modelos: lista,
        total: lista.reduce((s, m) => s + m.total, 0),
        variacoes: lista.reduce((s, m) => s + m.linhas.length, 0),
      };
    });
}

/** O que a folha diz no cabeçalho sobre o recorte (para ninguém achar que é a loja inteira). */
export function recorteDaFolha(opts: { categoria?: string; q?: string; inativos?: boolean }): string {
  const partes: string[] = [];
  partes.push(opts.categoria ? `Categoria: ${opts.categoria}` : "Todas as categorias");
  if (opts.q?.trim()) partes.push(`busca "${opts.q.trim()}"`);
  partes.push(opts.inativos ? "com produtos inativos" : "só produtos ativos");
  return partes.join(" · ");
}
