/**
 * URL pública do catálogo de uma loja.
 *
 * Quando há um domínio dedicado aos catálogos (CATALOG_DOMAIN, ex.:
 * "catalago.net"), o link fica curto e sem a marca da plataforma:
 *   catalago.net/toque-leve
 * Sem o domínio (dev/preview), cai no caminho interno /catalogo/toque-leve.
 */

/** Domínio de catálogos configurado no ambiente (ou null). */
export function catalogDomain(): string | null {
  return process.env.CATALOG_DOMAIN?.trim() || null;
}

/** URL pública (absoluta quando há domínio de catálogos; senão, caminho interno). */
export function catalogUrl(slug: string, domain?: string | null): string {
  const dom = domain !== undefined ? domain : catalogDomain();
  return dom ? `https://${dom}/${slug}` : `/catalogo/${slug}`;
}

/** Rótulo curto para exibição (sem https://). */
export function catalogLabel(slug: string, domain?: string | null): string {
  const dom = domain !== undefined ? domain : catalogDomain();
  return dom ? `${dom}/${slug}` : `/catalogo/${slug}`;
}
