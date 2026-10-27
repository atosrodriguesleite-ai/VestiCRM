import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { barreiraDoRfm, evaluateSegment, gruposDoRfmUmaVez, lerFiltroDaCampanha } from "@/lib/segments";
import { ehGrupoRfm } from "@/lib/bi/rfm-regra";
import { imageHref } from "@/lib/img";
import { catalogUrl } from "@/lib/catalog-url";
import { PageHeader } from "@/components/ui";
import { CampaignsView, type CampaignItem } from "./campaigns-view";
import { PromoCatalogs, type PromoItem, type PromoProduct } from "./promo-catalogs";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ rfm?: string | string[] }>;
}) {
  const user = await requireUser();
  // perfil Suporte é operacional: telas comerciais ficam fora do papel dele
  if (user.role === "SUPPORT") redirect("/pedidos");
  const { rfm } = await searchParams;

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

  // RN-098: o grupo do RFM é da gerência, na loja com o BI ligado (a loja já
  // veio no lote acima — sem ida extra ao banco); os grupos são lidos UMA vez
  // para todas as campanhas da tela
  const barreira = barreiraDoRfm(user, company?.biEnabled ?? false);
  const rfmLiberado = barreira === null;
  const gruposDoRfm = gruposDoRfmUmaVez(user, rfmLiberado);
  // o atalho "Criar campanha" do BI abre a janela com o grupo escolhido
  const abrirComRfm = rfmLiberado && ehGrupoRfm(rfm) ? rfm : null;

  const items: CampaignItem[] = await Promise.all(
    campaigns.map(async (c) => {
      const lido = lerFiltroDaCampanha(c.filterJson);
      // campanha pelo grupo do RFM, vista por quem não pode usá-lo: nem o
      // número (diria quantas são "Não posso perder") nem o disparo; e o
      // filtro que não se lê não vira "todas as clientes"
      const fechada = lido?.rfmGrupo != null ? barreira : null;
      const reach = !lido || fechada ? null : (await evaluateSegment(user, lido, { gruposDoRfm })).length;
      return {
        id: c.id,
        name: c.name,
        message: c.message,
        status: c.status,
        filter: lido ?? {},
        reach,
        bloqueio: !lido ? "ilegivel" : fechada,
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
        rfmLiberado={rfmLiberado}
        abrirComRfm={abrirComRfm}
        linkDoCatalogo={company ? catalogUrl(company.slug) : ""}
      />
    </div>
  );
}
