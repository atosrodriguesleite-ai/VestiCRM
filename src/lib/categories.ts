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

/**
 * DESCRIÇÃO DA CATEGORIA no catálogo público (Company.categoryDescriptions,
 * JSON objeto nome→texto).
 *
 * Antes o catálogo mostrava a descrição do PRIMEIRO produto da categoria. O
 * texto mudava sozinho quando a ordem dos produtos mudava, e a sincronização
 * da Nuvemshop (que sobrescreve a descrição do produto) podia trocar o texto
 * da seção inteira sem ninguém pedir. Agora o texto é da CATEGORIA.
 *
 * A chave é comparada SEM diferenciar maiúscula/acento — "Regata Alça" e
 * "regata alca" são a mesma categoria, igual ao resto do sistema.
 */
export type DescricoesDeCategoria = Record<string, string>;

const chave = (nome: string) =>
  nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export const LIMITE_DESCRICAO = 220;

export function parseCategoryDescriptions(
  json: string | null | undefined
): DescricoesDeCategoria {
  try {
    const parsed = JSON.parse(json || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DescricoesDeCategoria = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[chave(k)] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Texto da categoria; vazio quando a lojista não escreveu nada. */
export function descricaoDaCategoria(
  mapa: DescricoesDeCategoria,
  nome: string
): string {
  return mapa[chave(nome)] ?? "";
}

/** Grava (ou apaga, com texto vazio) a descrição de uma categoria. */
export function definirDescricao(
  mapa: DescricoesDeCategoria,
  nome: string,
  texto: string
): DescricoesDeCategoria {
  const proximo = { ...mapa };
  const limpo = texto.trim().slice(0, LIMITE_DESCRICAO);
  if (limpo) proximo[chave(nome)] = limpo;
  else delete proximo[chave(nome)];
  return proximo;
}

/** Categoria renomeada leva o texto junto (senão a descrição sumia no rename). */
export function renomearDescricao(
  mapa: DescricoesDeCategoria,
  de: string,
  para: string
): DescricoesDeCategoria {
  const texto = descricaoDaCategoria(mapa, de);
  const proximo = { ...mapa };
  delete proximo[chave(de)];
  if (texto) proximo[chave(para)] = texto;
  return proximo;
}

/** Categoria apagada não deixa texto órfão para trás. */
export function removerDescricao(
  mapa: DescricoesDeCategoria,
  nome: string
): DescricoesDeCategoria {
  const proximo = { ...mapa };
  delete proximo[chave(nome)];
  return proximo;
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
