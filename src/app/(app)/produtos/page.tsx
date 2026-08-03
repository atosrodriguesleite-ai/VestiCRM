import { ExternalLink, QrCode } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { PageHeader } from "@/components/ui";
import { ProductsView, type ProductItem } from "./products-view";
import { catalogUrl } from "@/lib/catalog-url";
import { isManagerUp, isSupport } from "@/lib/scope";
import { parseCategoryOrder } from "@/lib/categories";
import { StockMonitor, type LowStockRow } from "./stock-monitor";
import { PhotoDoctor } from "./photo-doctor";
import { ExportCatalog } from "./export-catalog";
import { SkuManager } from "./sku-manager";
import { CategoryManager } from "./category-manager";

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
      images: { orderBy: { order: "asc" }, select: { id: true, color: true } },
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
    weightGrams: p.weightGrams,
    active: p.active,
    tags: p.tags,
    images: p.images.map((i) => ({ id: i.id, url: imageHref(i.id), color: i.color })),
    variants: p.variants.map((v) => ({
      id: v.id,
      color: v.color,
      size: v.size,
      stock: v.stock,
      sku: v.sku,
    })),
  }));

  // categorias = as usadas em produtos + as criadas à mão (mesmo sem produto)
  const categories = [
    ...new Set([
      ...products.map((p) => p.category),
      ...parseCategoryOrder(company?.extraCategories),
    ]),
  ].sort();
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

  // monitor de estoque: todas as variações de produtos ativos. O filtro pelo
  // limite acontece no cliente (ao vivo), pra atualizar na hora que o dono
  // muda o número — sem recarregar a página.
  const threshold = company?.lowStockThreshold ?? 5;
  const activeVariations: LowStockRow[] = products
    .filter((p) => p.active)
    .flatMap((p) =>
      p.variants.map((v) => ({
        product: p.name,
        color: v.color,
        size: v.size,
        stock: v.stock,
      }))
    );

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Produtos"
        subtitle={`${items.length} produto${items.length === 1 ? "" : "s"} no catálogo da loja.`}
        action={
          company && (
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {(isManagerUp(user) || isSupport(user)) && <CategoryManager />}
              {isManagerUp(user) && <SkuManager />}
              {isManagerUp(user) && <ExportCatalog />}
              {isManagerUp(user) && <PhotoDoctor />}
              <a
                href={`/api/qrcode?url=${encodeURIComponent(
                  catalogUrl(company.slug).startsWith("http")
                    ? catalogUrl(company.slug)
                    : `https://www.atacadopro.com${catalogUrl(company.slug)}`
                )}`}
                download={`qr-catalogo-${company.slug}.svg`}
                title="Baixar QR Code do catálogo (imprimir na sacola, vitrine...)"
                className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition"
              >
                <QrCode className="size-4" />
                <span className="hidden sm:inline">QR Code</span>
              </a>
              <a
                href={catalogUrl(company.slug)}
                target="_blank"
                className="flex items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium px-4 py-2.5 transition"
              >
                <ExternalLink className="size-4" />
                <span className="hidden sm:inline">Catálogo do cliente</span>
                <span className="sm:hidden">Catálogo</span>
              </a>
            </div>
          )
        }
      />
      <StockMonitor
        variations={activeVariations}
        threshold={threshold}
        canManage={isManagerUp(user)}
        canToggleHide
        hideOutOfStock={company?.catalogHideOutOfStock ?? false}
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
        mediaLibrary={company?.mediaLibraryEnabled ?? false}
      />
    </div>
  );
}
