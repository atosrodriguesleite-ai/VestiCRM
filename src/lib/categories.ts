/**
 * Ordem das categorias no catálogo público, escolhida pelo lojista em
 * "Personalizar catálogo". Guardada como JSON array no Company.categoryOrder.
 * Categorias fora da lista salva (criadas depois) entram no FIM, mantendo a
 * ordem natural entre si — ninguém some do catálogo por não estar na lista.
 */

export function parseCategoryOrder(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function sortCategories(categories: string[], saved: string[]): string[] {
  if (!saved.length) return categories;
  const pos = new Map(saved.map((c, i) => [c.toLowerCase(), i]));
  // sort é estável: empates (categorias novas) preservam a ordem natural
  return [...categories].sort(
    (a, b) =>
      (pos.get(a.toLowerCase()) ?? saved.length) -
      (pos.get(b.toLowerCase()) ?? saved.length)
  );
}
