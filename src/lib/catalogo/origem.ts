/**
 * ORIGEM DA VISITA QUE SOBREVIVE À SESSÃO — a comissão não morre da noite
 * pro dia.
 *
 * Auditoria 06/08/2026: a cliente abria o catálogo pelo link da vendedora
 * (?ref=lara), montava a sacola e fechava. A SACOLA sobrevivia no aparelho,
 * mas o ?ref não: no dia seguinte ela abria o catálogo sem parâmetro, enviava
 * o pedido, e ele nascia "da loja" — a comissão da Lara sumia.
 *
 * Regras:
 *  • link COM parâmetro de origem (ref/c/utm) vale na hora e é GUARDADO no
 *    aparelho — link novo sobrescreve o antigo (quem mandou o link que a
 *    cliente acabou de abrir é quem está atendendo);
 *  • visita SEM parâmetro reaproveita a origem guardada por até 7 dias;
 *  • depois de 7 dias a origem vence e a visita conta como veio (direto).
 */

export type Origem = Record<string, string | null>;

const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

const CAMPOS = [
  "ref",
  "c",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const chave = (slug: string) => `ap-origem:${slug}`;

/** A URL trouxe algum parâmetro de origem? */
export function temOrigemNaUrl(atual: Origem): boolean {
  return CAMPOS.some((k) => Boolean(atual[k]));
}

/**
 * Resolve a origem da visita: a da URL (guardando-a) ou a lembrada no
 * aparelho (se ainda válida). Nunca lança — storage quebrado = usa a URL.
 */
export function lembrarOrigem(
  storage: StorageLike,
  slug: string,
  atual: Origem,
  agora: number = Date.now()
): Origem {
  try {
    if (temOrigemNaUrl(atual)) {
      const guardar: Origem = {};
      for (const k of CAMPOS) guardar[k] = atual[k] ?? null;
      storage.setItem(chave(slug), JSON.stringify({ at: agora, origem: guardar }));
      return atual;
    }
    const cru = storage.getItem(chave(slug));
    if (!cru) return atual;
    const salvo = JSON.parse(cru) as { at?: number; origem?: Origem };
    if (!salvo?.origem || typeof salvo.at !== "number") return atual;
    if (agora - salvo.at > VALIDADE_MS) {
      storage.removeItem(chave(slug));
      return atual;
    }
    // preenche SÓ o que a URL não trouxe (aqui, nada trouxe)
    const merged: Origem = { ...atual };
    for (const k of CAMPOS) merged[k] = salvo.origem[k] ?? null;
    return merged;
  } catch {
    return atual;
  }
}
