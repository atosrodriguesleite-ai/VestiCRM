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
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const company = await db.company.findUnique({ where: { slug } });
  if (!company) notFound();

  const products = await db.product.findMany({
    where: { companyId: company.id, active: true },
    include: {
      images: { orderBy: { order: "asc" } },
      variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
    },
    orderBy: [{ collection: "desc" }, { name: "asc" }],
  });

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
      storeName={company.name}
      tagline={company.tagline}
      whatsapp={company.whatsapp}
      minOrder={company.minOrder}
      products={items}
    />
  );
}
