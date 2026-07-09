import type { MetadataRoute } from "next";

const SITE_URL = "https://www.atacadopro.com.br";

/** Sitemap público (apenas a Landing Page é indexável). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
