import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { evaluateSegment, type SegmentFilter } from "@/lib/segments";
import { PageHeader } from "@/components/ui";
import { CampaignsView, type CampaignItem } from "./campaigns-view";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const user = await requireUser();

  const [campaigns, tags, interests] = await Promise.all([
    db.campaign.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
    }),
    db.tag.findMany({ where: { companyId: user.companyId } }),
    db.interest.findMany({ where: { companyId: user.companyId } }),
  ]);

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
        title="Campanhas de reativação"
        subtitle="Segmente clientes e monte campanhas para trazer quem sumiu de volta."
      />
      <CampaignsView
        campaigns={items}
        tags={tags.map((t) => t.name)}
        interests={interests.map((i) => i.name)}
      />
    </div>
  );
}
