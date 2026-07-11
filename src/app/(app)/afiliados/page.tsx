import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { ensurePlatformCompany } from "@/lib/platform";
import { PageHeader } from "@/components/ui";
import { AffiliatesView, type AffiliateRow } from "./affiliates-view";

export const dynamic = "force-dynamic";

/**
 * Afiliados da plataforma (só Super Admin): quem divulga o AtacadoPro com
 * link próprio. Cada lead que entra pelo link fica atribuído ao afiliado —
 * a tela mostra leads e fechamentos de cada um, para saber a quem pagar.
 * O valor da comissão é negociado caso a caso (campo de observações).
 */
export default async function AfiliadosPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const platformId = await ensurePlatformCompany();
  const affiliates = await db.affiliate.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      customers: {
        where: { companyId: platformId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          opportunities: { select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const rows: AffiliateRow[] = affiliates.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    phone: a.phone,
    pixKey: a.pixKey,
    notes: a.notes,
    active: a.active,
    leads: a.customers.length,
    won: a.customers.filter((c) =>
      c.opportunities.some((o) => o.status === "WON")
    ).length,
    recent: a.customers.slice(0, 8).map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt.toISOString(),
      won: c.opportunities.some((o) => o.status === "WON"),
    })),
  }));

  const siteUrl =
    process.env.MAIN_SITE_URL?.trim() || "https://www.atacadopro.com";

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Afiliados"
        subtitle="Quem divulga o AtacadoPro com link próprio. Cada lead que entrar pelo link fica atribuído ao afiliado — assim você sabe a quem pagar comissão."
      />
      <AffiliatesView initial={rows} siteUrl={siteUrl} />
    </div>
  );
}
