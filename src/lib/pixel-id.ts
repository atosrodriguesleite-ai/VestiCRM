/**
 * IDs DE PIXEL/ANALYTICS — validação e higiene.
 *
 * Auditoria 07/08/2026 (GRAVE): metaPixelId e gaId da bio eram interpolados
 * CRUS dentro de <Script> na página pública que a cliente final abre. Um
 * gerente (ou Super Admin impersonando) podia gravar
 * `x');alert(document.domain);('` e injetar JS arbitrário em produção
 * (phishing/skimming). Estes campos só podem conter o que um ID de verdade
 * contém — e nunca aspa, ponto-e-vírgula ou parêntese.
 *
 * Dupla proteção: a API valida na GRAVAÇÃO (schema) e a página higieniza na
 * EXIBIÇÃO (defesa em profundidade — dados já no banco também ficam seguros).
 */

/** Meta Pixel: só dígitos (o pixel id do Facebook é numérico, 15-16 dígitos). */
export const META_PIXEL_RE = /^\d{6,20}$/;

/** Google: G-XXXX (GA4), UA-123-4 (Universal), AW-123 (Ads). */
export const GA_ID_RE = /^(G-[A-Z0-9]{4,15}|UA-\d{4,12}-\d{1,4}|AW-\d{6,15})$/i;

/** Aceita vazio/nulo (campo opcional) ou um Meta Pixel bem-formado. */
export function metaPixelValido(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return s === "" || META_PIXEL_RE.test(s);
}

/** Aceita vazio/nulo ou um id de Google (GA4/UA/Ads) bem-formado. */
export function gaIdValido(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  return s === "" || GA_ID_RE.test(s);
}

/**
 * Rede de segurança da EXIBIÇÃO: devolve o id só se for válido; qualquer
 * coisa fora do formato (inclusive lixo já gravado antes desta correção)
 * vira null e o <Script> nem é renderizado. Nunca deixa passar um caractere
 * que quebre a string do script.
 */
export function metaPixelSeguro(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return META_PIXEL_RE.test(s) ? s : null;
}

export function gaIdSeguro(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return GA_ID_RE.test(s) ? s : null;
}
