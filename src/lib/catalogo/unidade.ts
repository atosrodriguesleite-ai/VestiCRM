import { chaveDeCategoria } from "../categories";

/**
 * RN-068 · COMO CHAMAR A UNIDADE NO CATÁLOGO PÚBLICO.
 *
 * O catálogo sempre escreveu "R$ 86,90 / peça". Para quem vende CONJUNTO
 * (bermuda + top), kit ou par, a palavra está errada na vitrine — e a
 * lojista não tinha onde mudar (pedido do dono, 02/10/2026, com o print da
 * cliente).
 *
 * Três decisões sustentam a regra:
 *
 *  1. É um PAR, singular e plural. O "/ peça" do card é só o lugar mais
 *     visível: o catálogo também escreve "faltam 3 peças para o mínimo",
 *     "adicionar 2 peças ao pedido" e a MENSAGEM que vai para o WhatsApp da
 *     loja ("2 peças · R$ 173,80"). Trocar só o singular deixava a cliente
 *     lendo "3 conjunto".
 *
 *  2. Vale a ESCADA peça > categoria > loja — a mesma do mínimo de estoque
 *     (RN-051) e do NCM (RN-055), e pelo mesmo motivo: a loja que vende só
 *     conjunto configura uma vez; a que tem a categoria "Conjuntos" configura
 *     lá; o kit solto dentro de "Conjuntos" se corrige na própria ficha.
 *
 *  3. Texto sobre UM produto usa a palavra DELE (o preço do card, a ficha, o
 *     atacado, a linha dele na mensagem); texto sobre o PEDIDO INTEIRO (o
 *     mínimo da sacola, que mistura categorias) usa a palavra da LOJA. E as
 *     telas internas — Separação, Estoque, relatórios — NÃO mudam: ali um
 *     pedido mistura tudo e "4 de 4 peças bipadas" precisa ser uma palavra só.
 *
 * Loja que não configurar nada não muda em NADA: continua "peça".
 */

export type Unidade = { singular: string; plural: string };

export const UNIDADE_PADRAO: Unidade = { singular: "peça", plural: "peças" };

/** Teto de cada palavra: "conjunto", "par de meias" cabem; frase, não. */
export const LIMITE_UNIDADE = 20;

// só letra (com acento), espaço e hífen: a palavra vai para a vitrine pública
// e para a mensagem do WhatsApp — número, emoji e pontuação ali é sujeira
const PALAVRA = /^[\p{L}][\p{L} -]*$/u;

const limpar = (v: string | null | undefined) =>
  (v ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export type LeituraDeUnidade =
  | { ok: true; unidade: Unidade | null }
  | { ok: false; erro: string };

/**
 * Lê o par digitado. Os dois vazios = "não configurado" (volta ao padrão de
 * cima na escada); um só preenchido é RECUSADO — gravar metade deixaria
 * "3 conjunto" ou "1 conjuntos" na vitrine.
 */
export function lerUnidade(
  singular: string | null | undefined,
  plural: string | null | undefined
): LeituraDeUnidade {
  const s = limpar(singular);
  const p = limpar(plural);
  if (!s && !p) return { ok: true, unidade: null };
  if (!s || !p) {
    return {
      ok: false,
      erro: "Preencha o singular e o plural juntos (ex.: conjunto / conjuntos) — ou deixe os dois vazios.",
    };
  }
  for (const [rotulo, v] of [["singular", s], ["plural", p]] as const) {
    if (v.length > LIMITE_UNIDADE) {
      return { ok: false, erro: `O ${rotulo} passa de ${LIMITE_UNIDADE} letras.` };
    }
    if (!PALAVRA.test(v)) {
      return { ok: false, erro: `O ${rotulo} só pode ter letras (sem número nem símbolo).` };
    }
  }
  return { ok: true, unidade: { singular: s, plural: p } };
}

/**
 * Confere e NORMALIZA o par vindo de uma porta de escrita (loja, categoria,
 * peça), gravando de volta no próprio payload. Devolve a frase de recusa, ou
 * null quando está tudo certo. É UMA função para as três portas de propósito:
 * a regra "os dois ou nenhum" copiada em cada rota é onde a quarta porta
 * (importação, sync) esqueceria dela (achado da revisão, 02/10/2026).
 */
export function aplicarParDaUnidade(payload: {
  unidadeSingular?: string | null;
  unidadePlural?: string | null;
}): string | null {
  if (payload.unidadeSingular === undefined && payload.unidadePlural === undefined) return null;
  const lida = lerUnidade(payload.unidadeSingular, payload.unidadePlural);
  if (!lida.ok) return lida.erro;
  payload.unidadeSingular = lida.unidade?.singular ?? null;
  payload.unidadePlural = lida.unidade?.plural ?? null;
  return null;
}

/** Palavra certa para a quantidade: "1 conjunto", "3 conjuntos". */
export function contar(n: number, u: Unidade): string {
  return `${n} ${n === 1 ? u.singular : u.plural}`;
}

// ---------------------------------------------------------------------------
// A ESCADA
// ---------------------------------------------------------------------------

export type UnidadesPorCategoria = Record<string, Unidade>;

/** Lê o JSON gravado na loja (categoria → par). Lixo é ignorado, nunca derruba. */
export function parseCategoryUnits(json: string | null | undefined): UnidadesPorCategoria {
  try {
    const parsed = JSON.parse(json || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: UnidadesPorCategoria = {};
    for (const [k, v] of Object.entries(parsed)) {
      const lida = lerUnidade(
        (v as { singular?: string })?.singular,
        (v as { plural?: string })?.plural
      );
      if (lida.ok && lida.unidade) out[chaveDeCategoria(k)] = lida.unidade;
    }
    return out;
  } catch {
    return {};
  }
}

export function unidadeDaCategoria(mapa: UnidadesPorCategoria, nome: string): Unidade | null {
  return mapa[chaveDeCategoria(nome)] ?? null;
}

/** Grava (ou apaga, com `null`) a unidade de uma categoria. */
export function definirUnidade(
  mapa: UnidadesPorCategoria,
  nome: string,
  unidade: Unidade | null
): UnidadesPorCategoria {
  const proximo = { ...mapa };
  if (unidade) proximo[chaveDeCategoria(nome)] = unidade;
  else delete proximo[chaveDeCategoria(nome)];
  return proximo;
}

/** Categoria renomeada leva a unidade junto (a mesma lição da descrição). */
export function renomearUnidade(
  mapa: UnidadesPorCategoria,
  de: string,
  para: string
): UnidadesPorCategoria {
  const u = unidadeDaCategoria(mapa, de);
  const proximo = { ...mapa };
  delete proximo[chaveDeCategoria(de)];
  if (u) proximo[chaveDeCategoria(para)] = u;
  return proximo;
}

export function removerUnidade(mapa: UnidadesPorCategoria, nome: string): UnidadesPorCategoria {
  const proximo = { ...mapa };
  delete proximo[chaveDeCategoria(nome)];
  return proximo;
}

/** O degrau da LOJA: o que vale para a sacola inteira e para quem não tem nada acima. */
export function unidadeDaLoja(loja: {
  unidadeSingular?: string | null;
  unidadePlural?: string | null;
}): Unidade {
  const lida = lerUnidade(loja.unidadeSingular, loja.unidadePlural);
  return lida.ok && lida.unidade ? lida.unidade : UNIDADE_PADRAO;
}

/**
 * A unidade de UMA peça: a dela > a da categoria > a da loja > "peça".
 * Par torto gravado em algum degrau é pulado, não derruba a conta.
 */
export function unidadeDaPeca(
  peca: { unidadeSingular?: string | null; unidadePlural?: string | null; category: string },
  porCategoria: UnidadesPorCategoria,
  loja: Unidade
): Unidade {
  const propria = lerUnidade(peca.unidadeSingular, peca.unidadePlural);
  if (propria.ok && propria.unidade) return propria.unidade;
  return unidadeDaCategoria(porCategoria, peca.category) ?? loja;
}
