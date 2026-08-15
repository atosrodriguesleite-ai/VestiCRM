/**
 * A RÉGUA ÚNICA DOS TAMANHOS (pedido do dono, 12/08/2026).
 *
 * Toda tela que lista tamanhos ordenava por alfabeto — e no alfabeto o G vem
 * antes do M, o GG antes do P: a grade aparecia "G, GG, M, P" e a loja
 * caçava o tamanho no meio da lista. Aqui mora a ordem DE ROUPA, usada por
 * todas as telas (Produtos, catálogo público, montagem de pedido, romaneio):
 *
 *   PP < P < M < G < GG < XG… < numeração crescente (32 < 33 < 34) < Único
 */

/** Letras de grade, na ordem da arara. */
const ORDEM_LETRAS = ["PP", "P", "M", "G", "GG", "XG", "EG", "XGG", "EGG", "EXG", "G1", "G2", "G3", "G4"];

/**
 * Peso do tamanho para ordenação: letras primeiro (PP…GG…), depois a
 * numeração (32, 34, 36… crescente), "Único" e desconhecidos no fim.
 */
export function pesoTamanho(tamanho: string | null | undefined): number {
  const s = (tamanho ?? "").trim().toUpperCase();
  if (!s) return 990;
  const letra = ORDEM_LETRAS.indexOf(s);
  if (letra >= 0) return letra;
  const numero = parseInt(s.replace(/\D/g, ""), 10);
  if (!Number.isNaN(numero) && numero > 0) return 100 + numero;
  if (s === "ÚNICO" || s === "UNICO") return 980;
  return 900; // desconhecido: perto do fim, desempate alfabético
}

const alfab = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

/** Comparador de tamanhos: peso de roupa primeiro, alfabeto como desempate. */
export function compararTamanhos(a: string | null | undefined, b: string | null | undefined): number {
  return pesoTamanho(a) - pesoTamanho(b) || alfab(a ?? "", b ?? "");
}

/** Lista de tamanhos em ordem de roupa (para filtros e seletores). */
export function ordenarTamanhos<T extends string | null>(tamanhos: readonly T[]): T[] {
  return [...tamanhos].sort(compararTamanhos);
}

/**
 * Grade de variações na ordem da arara: cor (alfabética) e, dentro dela, o
 * tamanho de roupa. É a ordem que as telas mostram — o banco não sabe que
 * "PP" vem antes de "P".
 */
export function ordenarVariantes<T extends { color: string | null; size: string | null }>(
  variantes: readonly T[]
): T[] {
  return [...variantes].sort(
    (a, b) => alfab(a.color ?? "", b.color ?? "") || compararTamanhos(a.size, b.size)
  );
}
