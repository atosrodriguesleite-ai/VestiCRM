import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { ensurePlatformCompany } from "@/lib/platform";
import { PageHeader } from "@/components/ui";
import { PortfolioView, type ProdutoRow } from "./portfolio-view";

export const dynamic = "force-dynamic";

/**
 * PORTFÓLIO DE PRODUTOS (só Super Admin).
 *
 * O manual dos serviços que a plataforma vende junto com o CRM: o que é,
 * para quem serve, como vender, quanto custa entregar e como entregar.
 * Material interno do dono — nenhuma loja enxerga esta tela.
 */
export default async function PortfolioPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const companyId = await ensurePlatformCompany();
  const produtos = await db.portfolioProduct.findMany({
    where: { companyId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      variants: { orderBy: { order: "asc" } },
      positions: { orderBy: { order: "asc" } },
    },
  });

  const rows: ProdutoRow[] = produtos.map((p) => ({
    id: p.id,
    name: p.name,
    shortDesc: p.shortDesc,
    category: p.category,
    status: p.status,
    duration: p.duration,
    baseValue: p.baseValue,
    ownerName: p.ownerName,
    variants: p.variants.map((v) => ({ name: v.name, baseValue: v.baseValue })),
    custo: p.positions.reduce((s, x) => s + (x.cost || 0), 0),
  }));

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Portfólio de Produtos"
        subtitle="Os serviços que você vende junto com o AtacadoPro: o que é, para quem serve, como vender e como entregar. Material interno — só você vê esta tela."
      />
      <PortfolioView initial={rows} />
    </div>
  );
}
