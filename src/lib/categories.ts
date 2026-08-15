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

/**
 * TIPO DE PEÇA — o guarda-chuva das categorias no catálogo público.
 *
 * "Blusas" agrupa Regata Alça, Baby Look e Ombro Único; "Shorts" agrupa os
 * shorts. No catálogo viram duas barras: o tipo em cima, e embaixo só as
 * categorias daquele tipo.
 *
 * O vínculo é da CATEGORIA, não da peça: a lojista diz uma vez "Regata Alça é
 * Blusas" e toda peça dessa categoria — inclusive as que ela cadastrar amanhã
 * — já nasce no guarda-chuva certo. Marcar peça por peça seria trabalho eterno.
 *
 * A ORDEM dos tipos sai da ordem das categorias (`categoryOrder`): o tipo
 * aparece na posição da primeira categoria dele. Uma régua só — arrumar a
 * ordem das categorias arruma a dos tipos junto, sem nada para sincronizar.
 */
export type TiposDeCategoria = Record<string, string>;

/** Categoria sem guarda-chuva não some do catálogo: cai neste balde, no fim. */
export const TIPO_SEM_DONO = "Outros";

export function parseCategoryTypes(
  json: string | null | undefined
): TiposDeCategoria {
  try {
    const parsed = JSON.parse(json || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TiposDeCategoria = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[chave(k)] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Tipo de uma categoria; vazio quando ela ainda não tem guarda-chuva. */
export function tipoDaCategoria(mapa: TiposDeCategoria, nome: string): string {
  return mapa[chave(nome)] ?? "";
}

/** Tipos já em uso, sem repetir, na ordem em que aparecem. */
export function tiposEmUso(mapa: TiposDeCategoria): string[] {
  const vistos = new Map<string, string>();
  for (const t of Object.values(mapa)) {
    if (!vistos.has(chave(t))) vistos.set(chave(t), t);
  }
  return [...vistos.values()];
}

/**
 * Grava (ou tira, com texto vazio) o tipo de uma categoria.
 *
 * TRAVA CONTRA GÊMEO: se o tipo digitado já existe escrito de outro jeito
 * ("blusas" quando já existe "Blusas"), vale a grafia QUE JÁ ESTÁ EM USO. Sem
 * isso, um deslize de digitação criava um guarda-chuva quase igual e o
 * catálogo mostrava a mesma coisa duas vezes — e a lojista não ia entender.
 */
export function definirTipo(
  mapa: TiposDeCategoria,
  categoria: string,
  tipo: string
): TiposDeCategoria {
  const proximo = { ...mapa };
  const limpo = tipo.trim().slice(0, 40);
  if (!limpo) {
    delete proximo[chave(categoria)];
    return proximo;
  }
  const jaUsado = tiposEmUso(mapa).find((t) => chave(t) === chave(limpo));
  proximo[chave(categoria)] = jaUsado ?? limpo;
  return proximo;
}

/** Categoria renomeada leva o guarda-chuva junto. */
export function renomearTipo(
  mapa: TiposDeCategoria,
  de: string,
  para: string
): TiposDeCategoria {
  const tipo = tipoDaCategoria(mapa, de);
  const proximo = { ...mapa };
  delete proximo[chave(de)];
  if (tipo) proximo[chave(para)] = tipo;
  return proximo;
}

/** Categoria apagada não deixa vínculo órfão. */
export function removerTipo(
  mapa: TiposDeCategoria,
  categoria: string
): TiposDeCategoria {
  const proximo = { ...mapa };
  delete proximo[chave(categoria)];
  return proximo;
}

/**
 * Monta os guarda-chuvas na ordem em que devem aparecer, cada um com as
 * categorias dele. Recebe as categorias JÁ ordenadas (sortCategories).
 *
 * Devolve lista vazia quando NENHUMA categoria tem tipo — assim o catálogo de
 * quem não usa o recurso continua exatamente como era, sem barra a mais.
 */
export function agruparPorTipo(
  categoriasEmOrdem: string[],
  mapa: TiposDeCategoria
): { tipo: string; categorias: string[] }[] {
  if (categoriasEmOrdem.every((c) => !tipoDaCategoria(mapa, c))) return [];

  const grupos = new Map<string, { tipo: string; categorias: string[] }>();
  for (const cat of categoriasEmOrdem) {
    const tipo = tipoDaCategoria(mapa, cat) || TIPO_SEM_DONO;
    const atual = grupos.get(chave(tipo));
    if (atual) atual.categorias.push(cat);
    else grupos.set(chave(tipo), { tipo, categorias: [cat] });
  }
  // "Outros" sempre por último: é o balde do que ainda não foi organizado
  const lista = [...grupos.values()];
  return [
    ...lista.filter((g) => chave(g.tipo) !== chave(TIPO_SEM_DONO)),
    ...lista.filter((g) => chave(g.tipo) === chave(TIPO_SEM_DONO)),
  ];
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
