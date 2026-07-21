/**
 * Gestor de Bio (módulo Marketing) — regras compartilhadas entre a página
 * pública, o redirecionador de cliques e o editor. Sem dependência de
 * cliente (pode rodar no servidor).
 */

import { catalogUrl } from "./catalog-url";

export type BioLinkKind = "CATALOGO" | "WHATSAPP" | "SITE" | "EXTERNO";

export const BIO_LINK_KINDS: {
  key: BioLinkKind;
  label: string;
  hint: string;
  needsUrl: boolean;
}[] = [
  { key: "CATALOGO", label: "Catálogo", hint: "Abre o seu catálogo público.", needsUrl: false },
  { key: "WHATSAPP", label: "WhatsApp", hint: "Abre uma conversa no seu WhatsApp.", needsUrl: false },
  { key: "SITE", label: "Site / E-commerce", hint: "Seu site ou loja online.", needsUrl: true },
  { key: "EXTERNO", label: "Link externo", hint: "Instagram, Shopee, promoção...", needsUrl: true },
];

/** Normaliza um link digitado pelo lojista (aceita sem https://). */
export function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const t = url.trim();
  if (!t) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(t)) return t;
  return `https://${t.replace(/^\/+/, "")}`;
}

/** wa.me a partir de um número BR (assume 55 quando vier sem DDI). */
export function waLink(whatsapp: string | null | undefined, text?: string): string | null {
  const num = (whatsapp ?? "").replace(/\D/g, "");
  if (!num) return null;
  const full = num.length <= 11 ? `55${num}` : num;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${full}${q}`;
}

/** Destino final de um botão da bio, conforme o tipo e o contexto da loja. */
export function resolveBioTarget(
  link: { type: BioLinkKind; url: string | null },
  ctx: { slug: string; whatsapp: string | null }
): string | null {
  switch (link.type) {
    case "CATALOGO":
      return catalogUrl(ctx.slug);
    case "WHATSAPP":
      return waLink(ctx.whatsapp, "Oi! Vim pela bio do Instagram 😊");
    case "SITE":
    case "EXTERNO":
      return normalizeUrl(link.url);
    default:
      return null;
  }
}
