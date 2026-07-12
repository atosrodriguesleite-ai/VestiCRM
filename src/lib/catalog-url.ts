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

/** Base + ref de vendedor para links rastreados (?c=) — uso nas telas. */
export function trackedLinkParts(user: { role: string; name: string }, slug: string) {
  const sellerRef =
    user.role === "SELLER" || user.role === "MANAGER"
      ? user.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/\s+/)[0]
      : null;
  return { base: catalogUrl(slug), sellerRef };
}

/**
 * Link rastreado BONITO: código curto no caminho, sem ?c= comprido.
 *   catalago.net/loja/julia/a3f9c2b   (com vendedor)
 *   catalago.net/loja/a3f9c2b         (sem vendedor)
 * Sem domínio dedicado (dev), cai em query string no caminho interno.
 */
export function trackedCatalogLink(
  base: string,
  sellerRef: string | null,
  code: string
): string {
  if (base.startsWith("http")) {
    return sellerRef ? `${base}/${sellerRef}/${code}` : `${base}/${code}`;
  }
  return sellerRef ? `${base}?ref=${sellerRef}&c=${code}` : `${base}?c=${code}`;
}
