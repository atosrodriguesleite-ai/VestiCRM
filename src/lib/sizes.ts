/**
 * Ordenação inteligente de tamanhos de roupa — sempre do MENOR para o MAIOR.
 * Cobre letras (PP, P, M, G, GG, XG...), tamanho único e numéricos (36, 38, 40).
 * Ordenar por string não funciona ("G" < "GG" < "M" < "P" alfabético fica torto),
 * então cada tamanho recebe um "posto" numérico e a lista é ordenada por ele.
 */

const LETTER: Record<string, number> = {
  PPP: 0, XXPP: 0,
  PP: 1, XP: 1, XPP: 1,
  P: 2, S: 2,
  M: 3,
  G: 4, L: 4,
  GG: 5, XG: 5, XL: 5, EG: 5, G1: 5,
  XGG: 6, XXG: 6, XXL: 6, EGG: 6, G2: 6,
  XXGG: 7, XXXG: 7, XXXL: 7, G3: 7,
  G4: 8,
};

const UNICO = new Set([
  "U", "UN", "UNI", "UNICO", "ÚNICO", "TU", "TAM UNICO", "TAM ÚNICO",
  "TAMANHO UNICO", "TAMANHO ÚNICO", "ONE SIZE", "ONESIZE", "OS",
]);

/** Posto numérico do tamanho (quanto menor, mais "para o começo"). */
export function sizeRank(raw: string): number {
  const s = (raw ?? "").trim().toUpperCase();
  if (s in LETTER) return LETTER[s];
  if (UNICO.has(s)) return 900;
  const num = s.match(/\d+/); // 36, 38, P42... pega o número
  if (num) return 1000 + parseInt(num[0], 10);
  return 5000; // desconhecido vai para o fim (com desempate alfabético)
}

/** Comparador para Array.sort — do menor para o maior. */
export function compareSizes(a: string, b: string): number {
  const ra = sizeRank(a);
  const rb = sizeRank(b);
  if (ra !== rb) return ra - rb;
  return (a ?? "").localeCompare(b ?? "", "pt-BR", { numeric: true });
}

/** Ordena uma lista de objetos pelo campo de tamanho. */
export function sortBySize<T>(list: T[], getSize: (item: T) => string): T[] {
  return [...list].sort((a, b) => compareSizes(getSize(a), getSize(b)));
}
