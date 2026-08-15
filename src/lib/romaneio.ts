/**
 * ORDEM DE SEPARAÇÃO DO ROMANEIO (pedido do dono, 12/08/2026).
 *
 * O romaneio imprimia os itens na ordem em que entraram no pedido — quem
 * separa ia e voltava pelo estoque atrás de peça espalhada. Aqui os itens
 * saem na ordem em que as peças ficam FISICAMENTE arrumadas:
 *
 *   categoria → produto → cor → tamanho (de gente) → quantidade (maior 1º)
 *
 * Assim tudo da mesma prateleira sai junto e a separação vira uma passada
 * só. O tamanho ordena como roupa (PP < P < M < G < GG < numeração), nunca
 * alfabético — no alfabeto o G vinha antes do M e bagunçava a arara.
 */

import { pesoTamanho } from "./tamanhos";

// a régua do tamanho mora em lib/tamanhos.ts — é a MESMA das telas
// (Produtos, catálogo, pedido); reexportada aqui por compatibilidade
export { pesoTamanho };

type ItemDoRomaneio = {
  productId: string | null;
  name: string;
  color: string | null;
  size: string | null;
  quantity: number;
};

const alfab = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

/**
 * Ordena os itens para a separação. `categoriaDe` traduz o produto para a
 * categoria do cadastro (a mesma do organizador de catálogo); item sem
 * produto vinculado (linha avulsa) cai no grupo vazio, no fim.
 */
export function ordenarParaSeparacao<T extends ItemDoRomaneio>(
  itens: readonly T[],
  categoriaDe: (productId: string | null) => string
): T[] {
  return [...itens].sort((a, b) => {
    const catA = categoriaDe(a.productId) || "￿"; // sem categoria: por último
    const catB = categoriaDe(b.productId) || "￿";
    return (
      alfab(catA, catB) ||
      alfab(a.name, b.name) ||
      alfab(a.color ?? "", b.color ?? "") ||
      pesoTamanho(a.size) - pesoTamanho(b.size) ||
      alfab(a.size ?? "", b.size ?? "") ||
      b.quantity - a.quantity
    );
  });
}
