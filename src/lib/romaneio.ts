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
/**
 * TOTAL DE PEÇAS POR CATEGORIA (pedido do dono, 16/09/2026): no romaneio,
 * cada bloco de categoria fecha com "Total: N peças" — quem separa confere
 * a prateleira inteira antes de passar para a próxima ("regata nadador,
 * 10 peças, confere, próxima"). Soma a QUANTIDADE, não linhas: duas linhas
 * da mesma regata (M e G) são 7 peças, não 2. Item sem categoria cai em ""
 * (o grupo "Outros itens"). A soma de todas as categorias é o total de
 * peças do pedido — o mesmo número da linha "Total de peças" do rodapé.
 */
export function totalPorCategoria(
  itens: readonly Pick<ItemDoRomaneio, "productId" | "quantity">[],
  categoriaDe: (productId: string | null) => string
): Map<string, number> {
  const soma = new Map<string, number>();
  for (const i of itens) {
    const cat = categoriaDe(i.productId) || "";
    soma.set(cat, (soma.get(cat) ?? 0) + i.quantity);
  }
  return soma;
}

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

/* ---- a nota do catálogo: dados da cliente × observação de fato ---------- */

/**
 * O pedido do catálogo nasce com uma nota em duas partes (RN-010/RN-027):
 * o CABEÇALHO que o sistema escreve ("Pedido recebido pelo catálogo
 * público.", "Nome: …", "Telefone: …", "CEP: …") e o que a CLIENTE digitou
 * no campo de observação ("pegou um GG quadrada verde no lugar da branca").
 *
 * No romaneio tudo saía junto no quadro "Observações do pedido", e os dados
 * tiravam o foco do recado que importa para quem separa (pedido do dono,
 * 05/10/2026). Aqui a nota é separada: as linhas rotuladas vão para um bloco
 * de dados, e só o recado sobra no quadro. A nota gravada NÃO muda — é só a
 * leitura para o papel.
 */
const CABECALHO_DO_CATALOGO = /^pedido recebido pelo cat[áa]logo p[úu]blico\.?$/i;
const LINHA_ROTULADA =
  /^(nome da loja|loja|nome|telefone|fone|whatsapp|cep|endere[çc]o(?:\s*\(rua e n[úu]mero\))?|bairro|cidade|estado(?:\s*\(uf\))?)\s*:/i;
const AVISO_DE_TELEFONE = /^⚠️\s*a cliente digitou um telefone diferente/i;

export function separarNotaDoCatalogo(notes: string | null | undefined): {
  /** as linhas de dados, sem o cabeçalho ("Nome: …", "CEP: …", o aviso do telefone) */
  dados: string[];
  /** o que sobra: a observação de fato, com as quebras de linha da pessoa */
  observacao: string;
} {
  const dados: string[] = [];
  const resto: string[] = [];
  for (const linha of (notes ?? "").split("\n")) {
    const t = linha.trim();
    if (CABECALHO_DO_CATALOGO.test(t)) continue;
    if (LINHA_ROTULADA.test(t) || AVISO_DE_TELEFONE.test(t)) dados.push(t);
    else resto.push(linha);
  }
  return { dados, observacao: resto.join("\n").trim() };
}
