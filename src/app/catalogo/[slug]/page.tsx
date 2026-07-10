import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PublicCatalog, type CatalogProduct } from "./public-catalog";

export const dynamic = "force-dynamic";

/**
 * Catálogo público — vitrine que a loja compartilha com o cliente final.
 * Sem login: mostra apenas produtos ativos da empresa do slug (nunca de
 * outra loja) e leva o cliente direto para o WhatsApp da loja.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const company = await db.company.findUnique({ where: { slug } });
  return {
    title: company ? `${company.name} — Catálogo` : "Catálogo",
    description: company?.tagline ?? "Catálogo de produtos",
  };
}

export default async function PublicCatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const company = await db.company.findUnique({ where: { slug } });
  if (!company) notFound();

  const [products, customColors] = await Promise.all([
    db.product.findMany({
      where: { companyId: company.id, active: true },
      include: {
        images: { orderBy: { order: "asc" } },
        variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
      },
      orderBy: [{ collection: "desc" }, { name: "asc" }],
    }),
    db.companyColor.findMany({
      where: { companyId: company.id },
      select: { name: true, hex: true },
    }),
  ]);

  const items: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    collection: p.collection,
    description: p.description,
    retailPrice: p.retailPrice,
    wholesalePrice: p.wholesalePrice,
    minQuantity: p.minQuantity,
    tags: p.tags,
    images: p.images.map((i) => i.url),
    variants: p.variants.map((v) => ({
      color: v.color,
      size: v.size,
      available: v.stock > 0,
    })),
  }));

  return (
    <PublicCatalog
      storeSlug={company.slug}
      storeName={company.name}
      tagline={company.tagline}
      whatsapp={company.whatsapp}
      minOrder={company.minOrder}
      minOrderMode={company.minOrderMode as "NONE" | "PECAS" | "VALOR"}
      minOrderValue={company.minOrderValue}
      products={items}
      logoSize={company.catalogLogoSize as "normal" | "grande"}
      identity={{
        logoUrl: company.logoUrl,
        primary: company.catalogPrimary,
        secondary: company.catalogSecondary,
        bg: company.catalogBg,
        font: company.catalogFont,
      }}
      customColors={customColors}
      tracking={{
        ref: sp.ref ?? null,
        utm_source: sp.utm_source ?? null,
        utm_medium: sp.utm_medium ?? null,
        utm_campaign: sp.utm_campaign ?? null,
        utm_term: sp.utm_term ?? null,
        utm_content: sp.utm_content ?? null,
      }}
    />
  );
}
