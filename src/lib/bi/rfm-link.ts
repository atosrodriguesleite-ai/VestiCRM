import { catalogUrl, trackedCatalogLink, trackedLinkParts } from "../catalog-url";

/**
 * O link do catálogo que vai na mensagem do RFM (RN-093/RN-100): o código
 * pessoal da cliente (`?c=`, RN-021) e, se ela tem dona ATIVA na carteira, a
 * ref da dona (RN-005) — quem chama (a gerência na lista do BI, a vendedora
 * na Agenda) nunca toma a venda nem a carteira. Sem dona, sem ref: a venda é
 * da loja. Puro: a lista do BI e a Agenda montam pelo mesmo caminho.
 */
export function linkDaClienteDoRfm(slug: string, dona: { nome: string; role: string } | null, codigo: string): string {
  const ref = dona ? trackedLinkParts({ name: dona.nome, role: dona.role }, slug).sellerRef : null;
  return trackedCatalogLink(catalogUrl(slug), ref, codigo);
}
