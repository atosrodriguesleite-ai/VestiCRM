import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ProductsView, type ProductItem } from "./products-view";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const user = await requireUser();

  const [company, libraryColors, librarySizes] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId } }),
    db.companyColor.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
    }),
    db.companySize.findMany({
      where: { companyId: user.companyId },
      orderBy: { order: "asc" },
    }),
  ]);
  const products = await db.product.findMany({
    where: { companyId: user.companyId },
    include: {
      variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
      images: { orderBy: { order: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  const items: ProductItem[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    brand: p.brand,
    collection: p.collection,
    description: p.description,
    costPrice: p.costPrice,
    wholesalePrice: p.wholesalePrice,
    retailPrice: p.retailPrice,
    minQuantity: p.minQuantity,
    active: p.active,
    tags: p.tags,
    images: p.images.map((i) => i.url),
    variants: p.variants.map((v) => ({
      id: v.id,
      color: v.color,
      size: v.size,
      stock: v.stock,
    })),
  }));

  const categories = [...new Set(products.map((p) => p.category))].sort();
  const collections = [
    ...new Set(products.map((p) => p.collection).filter(Boolean) as string[]),
  ].sort();
  const brands = [
    ...new Set(products.map((p) => p.brand).filter(Boolean) as string[]),
  ].sort();
  const colors = [
    ...new Set(products.flatMap((p) => p.variants.map((v) => v.color))),
  ].sort();
  const sizes = [
    ...new Set(products.flatMap((p) => p.variants.map((v) => v.size))),
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Produtos"
        subtitle={`${items.length} produto${items.length === 1 ? "" : "s"} no catálogo da loja.`}
        action={
          company && (
            <a
              href={`/catalogo/${company.slug}`}
              target="_blank"
              className="flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium px-4 py-2.5 transition"
            >
              <ExternalLink className="size-4" />
              <span className="hidden sm:inline">Catálogo do cliente</span>
              <span className="sm:hidden">Catálogo</span>
            </a>
          )
        }
      />
      <ProductsView
        initial={items}
        categories={categories}
        collections={collections}
        brands={brands}
        colors={colors}
        sizes={sizes}
        libraryColors={libraryColors.map((c) => ({ name: c.name, hex: c.hex }))}
        librarySizes={librarySizes.map((s) => s.name)}
      />
    </div>
  );
}
