import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { CampaignsManager, type Campanha } from "./campaigns-manager";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");

  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { marketingEnabled: true },
  });
  if (!company?.marketingEnabled) redirect("/dashboard");

  const rows = await db.marketingCampaign.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      channel: true,
      utmKey: true,
      active: true,
      _count: { select: { customers: true } },
    },
  });
  const campanhas: Campanha[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    channel: c.channel,
    utmKey: c.utmKey,
    active: c.active,
    leads: c._count.customers,
  }));

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Marketing"
        subtitle="Cadastre suas campanhas de anúncio. Ao registrar um lead (no “Lead + link”), o vendedor escolhe de qual campanha ele veio — e o painel de resultados por campanha nasce daí."
      />
      <CampaignsManager initial={campanhas} />
    </div>
  );
}
