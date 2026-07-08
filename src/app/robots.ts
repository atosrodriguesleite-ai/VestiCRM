import type { MetadataRoute } from "next";

const SITE_URL = "https://www.vesticrm.com.br";

/** robots.txt — a área logada (app) e as APIs não são indexadas. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/login", "/funil", "/clientes"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
