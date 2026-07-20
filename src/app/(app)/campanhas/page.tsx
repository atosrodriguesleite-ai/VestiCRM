import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { evaluateSegment, type SegmentFilter } from "@/lib/segments";
import { imageHref } from "@/lib/img";
import { catalogUrl } from "@/lib/catalog-url";
import { PageHeader } from "@/components/ui";
import { CampaignsView, type CampaignItem } from "./campaigns-view";
import { PromoCatalogs, type PromoItem, type PromoProduct } from "./promo-catalogs";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await requireUser();
  // perfil Suporte é operacional: telas comerciais ficam fora do papel dele
  if (user.role === "SUPPORT") redirect("/pedidos");

  const [campaigns, tags, interests, promos, promoProducts, company] =
    await Promise.all([
      db.campaign.findMany({
        where: { companyId: user.companyId },
        orderBy: { createdAt: "desc" },
      }),
      db.tag.findMany({ where: { companyId: user.companyId } }),
      db.interest.findMany({ where: { companyId: user.companyId } }),
      db.promoCatalog.findMany({
        where: { companyId: user.companyId },
        include: { _count: { select: { products: true } } },
        orderBy: { createdAt: "desc" },
      }),
      db.product.findMany({
        where: { companyId: user.companyId, active: true },
        include: { images: { orderBy: { order: "asc" }, take: 1, select: { id: true } } },
        orderBy: { name: "asc" },
      }),
      db.company.findUnique({ where: { id: user.companyId } }),
    ]);

  const promoItems: PromoItem[] = promos.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    discount: p.discount,
    active: p.active,
    products: p._count.products,
  }));
  const pickerProducts: PromoProduct[] = promoProducts.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    image: p.images[0] ? imageHref(p.images[0].id) : null,
    retailPrice: p.retailPrice,
  }));

  const items: CampaignItem[] = await Promise.all(
    campaigns.map(async (c) => {
      let filter: SegmentFilter = {};
      try {
        filter = JSON.parse(c.filterJson);
      } catch {
        filter = {};
      }
      const reach = await evaluateSegment(user, filter);
      return {
        id: c.id,
        name: c.name,
        message: c.message,
        status: c.status,
        filter,
        reach: reach.length,
        createdAt: c.createdAt.toISOString(),
      };
    })
  );

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Campanhas"
        subtitle="Catálogos promocionais com desconto próprio e campanhas de reativação para trazer quem sumiu de volta."
      />
      {company && (
        <PromoCatalogs
          initial={promoItems}
          products={pickerProducts}
          linkBase={catalogUrl(company.slug)}
        />
      )}
      <CampaignsView
        campaigns={items}
        tags={tags.map((t) => t.name)}
        interests={interests.map((i) => i.name)}
      />
    </div>
  );
}
