import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { parseCategoryDescriptions, parseCategoryOrder } from "@/lib/categories";
import { PublicCatalog, type CatalogProduct } from "../../public-catalog";

export const dynamic = "force-dynamic";

/**
 * Catálogo de CAMPANHA — vitrine à parte com produtos selecionados e
 * desconto próprio. O catálogo geral da loja continua intacto; aqui os
 * preços já aparecem com o desconto aplicado (e o original riscado).
 */

/** Preço com desconto da campanha, arredondado a centavos. */
const off = (v: number, discount: number) =>
  Math.round(v * (1 - discount / 100) * 100) / 100;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; promo: string }>;
}): Promise<Metadata> {
  const { slug, promo } = await params;
  const company = await db.company.findUnique({ where: { slug } });
  const pc = company
    ? await db.promoCatalog.findUnique({
        where: { companyId_slug: { companyId: company.id, slug: promo } },
      })
    : null;
  return {
    title:
      company && pc
        ? `${pc.name} — ${company.name}`
        : "Catálogo de campanha",
    description: pc ? `${pc.discount}% OFF em peças selecionadas` : undefined,
  };
}

export default async function PromoCatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; promo: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug, promo } = await params;
  const sp = await searchParams;
  const company = await db.company.findUnique({ where: { slug } });
  // loja suspensa sai do ar também nos catálogos de campanha
  if (!company || company.suspended) notFound();

  const pc = await db.promoCatalog.findUnique({
    where: { companyId_slug: { companyId: company.id, slug: promo } },
    include: { products: { select: { productId: true } } },
  });
  if (!pc || !pc.active || pc.products.length === 0) notFound();
  const selected = pc.products.map((p) => p.productId);

  const [products, customColors] = await Promise.all([
    db.product.findMany({
      // vitrine da campanha: também só com foto (item sem foto fica oculto);
      // e esconde os sem estoque quando a loja ativa essa opção
      where: {
        companyId: company.id,
        active: true,
        id: { in: selected },
        images: { some: {} },
        ...(company.catalogHideOutOfStock ? { variants: { some: { stock: { gt: 0 } } } } : {}),
      },
      include: {
        images: { orderBy: { order: "asc" }, select: { id: true } },
        variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
      },
      orderBy: [{ collection: "desc" }, { name: "asc" }],
    }),
    db.companyColor.findMany({
      where: { companyId: company.id },
      select: { name: true, hex: true },
    }),
  ]);
  if (products.length === 0) notFound();

  const items: CatalogProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    collection: p.collection,
    description: p.description,
    // preços JÁ com o desconto da campanha (o original vai riscado ao lado)
    retailPrice: off(p.retailPrice, pc.discount),
    wholesalePrice: off(p.wholesalePrice, pc.discount),
    originalRetailPrice: p.retailPrice,
    minQuantity: p.minQuantity,
    tags: p.tags,
    images: p.images.map((i) => imageHref(i.id)),
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
      categoryOrder={parseCategoryOrder(company.categoryOrder)}
      categoryDescriptions={parseCategoryDescriptions(company.categoryDescriptions)}
      promo={{ name: pc.name, slug: pc.slug, discount: pc.discount }}
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
        c: sp.c ?? null,
        utm_source: sp.utm_source ?? null,
        utm_medium: sp.utm_medium ?? null,
        // a campanha entra sozinha na atribuição da Inteligência Comercial
        utm_campaign: sp.utm_campaign ?? pc.slug,
        utm_term: sp.utm_term ?? null,
        utm_content: sp.utm_content ?? null,
      }}
    />
  );
}
