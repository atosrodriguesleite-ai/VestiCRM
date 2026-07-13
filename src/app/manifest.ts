import type { MetadataRoute } from "next";

/**
 * Manifesto do PWA — permite o lojista "instalar" o AtacadoPro na tela
 * inicial do celular (Adicionar à tela de início) e abrir em tela cheia,
 * como um app, sem a barra do navegador. Marca: monograma AP no espresso.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AtacadoPro",
    short_name: "AtacadoPro",
    description:
      "Gestão de vendas no atacado: catálogo, pedidos, funil e WhatsApp em um só lugar.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#16100b",
    theme_color: "#16100b",
    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
