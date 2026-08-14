import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { catalogPrice } from "@/lib/orders";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { ordenarVariantes } from "@/lib/tamanhos";
import {
  parseCategoryDescriptions,
  parseCategoryOrder,
  parseCategoryTypes,
} from "@/lib/categories";
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
  // loja suspensa não expõe nem o nome (mesmo tratamento de "não existe")
  if (!company || company.suspended) return { title: "Catálogo" };
  return {
    title: `${company.name} — Catálogo`,
    description: company.tagline ?? "Catálogo de produtos",
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
  // Loja suspensa (ex.: inadimplência) sai do ar também no público. Sem
  // isso a suspensão não tinha efeito nenhum: a loja continuava recebendo
  // pedidos pelo catálogo mesmo sem conseguir entrar no sistema.
  if (!company || company.suspended) notFound();

  const [products, customColors] = await Promise.all([
    db.product.findMany({
      // vitrine pública: só produtos COM foto (item sem foto fica oculto até
      // ganhar imagem — aparece sozinho assim que uma foto for adicionada).
      // Se a loja escolher, esconde também os sem estoque (indisponíveis).
      where: {
        companyId: company.id,
        active: true,
        images: { some: {} },
        ...(company.catalogHideOutOfStock ? { variants: { some: { stock: { gt: 0 } } } } : {}),
      },
      include: {
        images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
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
    // preço que ESTA loja escolheu exibir (e cobrar) no catálogo
    precoCatalogo: catalogPrice(p, company.catalogPriceMode),
    minQuantity: p.minQuantity,
    tags: p.tags,
    // url + cor etiquetada: o card de cada cor usa a foto DAQUELA cor
    images: p.images.map((i) => ({ url: imageHref(i.id), color: i.color })),
    // ordem de ROUPA (PP, P, M, G, GG / numeração crescente): as bolinhas de
    // tamanho do catálogo seguem a arara, não o alfabeto
    variants: ordenarVariantes(p.variants).map((v) => ({
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
      categoryTypes={parseCategoryTypes(company.categoryTypes)}
      logoSize={company.catalogLogoSize as "normal" | "grande"}
      // a chavinha vale por COR: o card da cor esgotada some da vitrine
      hideSoldOut={company.catalogHideOutOfStock}
      // loja sem variação de cor (semijoias): bolinha/nome de cor não aparecem
      hideColors={company.catalogHideColors}
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
        utm_campaign: sp.utm_campaign ?? null,
        utm_term: sp.utm_term ?? null,
        utm_content: sp.utm_content ?? null,
      }}
    />
  );
}
