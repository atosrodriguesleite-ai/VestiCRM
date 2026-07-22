/**
 * Gestor de Bio (módulo Marketing) — regras compartilhadas entre a página
 * pública, o redirecionador de cliques e o editor. Sem dependência de
 * cliente (pode rodar no servidor).
 */

import { catalogUrl } from "./catalog-url";
import { readableOn } from "./color";

export type BioLinkKind = "CATALOGO" | "WHATSAPP" | "SITE" | "EXTERNO";

/** Temas prontos (paletas) da bio — um clique aplica fundo + botão + texto. */
export const BIO_THEMES: {
  key: string;
  label: string;
  bgColor: string;
  buttonColor: string;
  buttonTextColor: string;
}[] = [
  { key: "terracota", label: "Terracota", bgColor: "#c4622d", buttonColor: "#ffffff", buttonTextColor: "#3f2a1c" },
  { key: "rose", label: "Rosé", bgColor: "#e8618c", buttonColor: "#ffffff", buttonTextColor: "#7a2947" },
  { key: "noite", label: "Preto & Ouro", bgColor: "#1c1917", buttonColor: "#f5d68a", buttonTextColor: "#3a2e12" },
  { key: "oliva", label: "Verde Oliva", bgColor: "#4d5b3a", buttonColor: "#f4f1e8", buttonTextColor: "#2f3a22" },
  { key: "oceano", label: "Oceano", bgColor: "#1e5f8c", buttonColor: "#ffffff", buttonTextColor: "#123a56" },
  { key: "lavanda", label: "Lavanda", bgColor: "#7c6cc4", buttonColor: "#ffffff", buttonTextColor: "#3f356b" },
  { key: "nude", label: "Nude", bgColor: "#c9a98a", buttonColor: "#fffaf4", buttonTextColor: "#5c4632" },
  { key: "vinho", label: "Vinho", bgColor: "#7a2140", buttonColor: "#f6dfe6", buttonTextColor: "#4a1226" },
  { key: "menta", label: "Menta", bgColor: "#2f9e8f", buttonColor: "#ffffff", buttonTextColor: "#1c5a52" },
  { key: "carvao", label: "Carvão", bgColor: "#2b2b31", buttonColor: "#3a3a44", buttonTextColor: "#f2f2f5" },
];

/** Galeria de imagens prontas para os botões (public/bio-icons/*.svg). */
export const BIO_BUTTON_ICONS: { key: string; label: string; url: string }[] = [
  { key: "catalogo", label: "Catálogo", url: "/bio-icons/catalogo.svg" },
  { key: "promocao", label: "Promoção", url: "/bio-icons/promocao.svg" },
  { key: "novidades", label: "Novidades", url: "/bio-icons/novidades.svg" },
  { key: "whatsapp", label: "WhatsApp", url: "/bio-icons/whatsapp.svg" },
  { key: "instagram", label: "Instagram", url: "/bio-icons/instagram.svg" },
  { key: "moda", label: "Moda", url: "/bio-icons/moda.svg" },
  { key: "destaque", label: "Destaque", url: "/bio-icons/destaque.svg" },
  { key: "atacado", label: "Atacado", url: "/bio-icons/atacado.svg" },
  { key: "frete", label: "Frete", url: "/bio-icons/frete.svg" },
  { key: "pix", label: "PIX", url: "/bio-icons/pix.svg" },
  { key: "presente", label: "Presente", url: "/bio-icons/presente.svg" },
  { key: "amei", label: "Amei", url: "/bio-icons/amei.svg" },
  { key: "localizacao", label: "Local", url: "/bio-icons/localizacao.svg" },
  { key: "agenda", label: "Agenda", url: "/bio-icons/agenda.svg" },
];

export const BIO_FONTS = ["montserrat", "inter", "poppins", "playfair", "lora"] as const;
export const BIO_SHAPES = ["rounded", "pill", "square"] as const;

/** Monta os links das redes sociais a partir dos @/usuários salvos. */
export function socialLinks(p: {
  instagram?: string | null;
  tiktok?: string | null;
  youtube?: string | null;
  facebook?: string | null;
}): { key: "instagram" | "tiktok" | "youtube" | "facebook"; url: string }[] {
  const h = (v: string) => v.replace(/^@+/, "").trim();
  const out: { key: "instagram" | "tiktok" | "youtube" | "facebook"; url: string }[] = [];
  if (p.instagram?.trim()) out.push({ key: "instagram", url: `https://instagram.com/${h(p.instagram)}` });
  if (p.tiktok?.trim()) out.push({ key: "tiktok", url: `https://tiktok.com/@${h(p.tiktok)}` });
  if (p.youtube?.trim())
    out.push({ key: "youtube", url: normalizeUrl(/^https?:/i.test(p.youtube) ? p.youtube : `youtube.com/@${h(p.youtube)}`)! });
  if (p.facebook?.trim())
    out.push({ key: "facebook", url: normalizeUrl(/^https?:/i.test(p.facebook) ? p.facebook : `facebook.com/${h(p.facebook)}`)! });
  return out;
}

/** Cores finais da bio: usa o tema próprio da página ou herda do catálogo. */
export function bioColors(
  page: {
    bgColor?: string | null;
    buttonColor?: string | null;
    buttonTextColor?: string | null;
  },
  catalog: { primary: string; secondary: string }
) {
  const bg = page.bgColor || catalog.primary;
  const button = page.buttonColor || "#ffffff";
  const buttonText = page.buttonTextColor || readableOn(button);
  return { bg, button, buttonText };
}

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
