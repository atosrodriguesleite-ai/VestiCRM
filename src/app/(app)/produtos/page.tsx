import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ProductsView, type ProductItem } from "./products-view";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const user = await requireUser();

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
      />
      <ProductsView
        initial={items}
        categories={categories}
        collections={collections}
        brands={brands}
        colors={colors}
        sizes={sizes}
      />
    </div>
  );
}
