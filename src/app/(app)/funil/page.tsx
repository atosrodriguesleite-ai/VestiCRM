import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { FunnelBoard, type BoardStage } from "./funnel-board";

export const dynamic = "force-dynamic";

export default async function FunnelPage() {
  const user = await requireUser();
  const scope = ownedScope(user);

  const pipeline = await db.pipeline.findFirst({
    where: { companyId: user.companyId },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  if (!pipeline) {
    return <p className="text-sm text-gray-500">Nenhum funil configurado.</p>;
  }

  const opps = await db.opportunity.findMany({
    where: { ...scope, stageId: { in: pipeline.stages.map((s) => s.id) } },
    include: {
      customer: {
        include: { tags: { include: { tag: true } } },
      },
      owner: true,
      tasks: {
        where: { status: "PENDENTE" },
        orderBy: { dueAt: "asc" },
        take: 1,
      },
    },
    orderBy: { lastInteractionAt: "desc" },
  });

  const customers = await db.customer.findMany({
    where: scope,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const stages: BoardStage[] = pipeline.stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    isWon: s.isWon,
    isLost: s.isLost,
    cards: opps
      .filter((o) => o.stageId === s.id)
      .map((o) => ({
        id: o.id,
        title: o.title,
        value: o.value,
        customerId: o.customerId,
        customerName: o.customer.name,
        phone: o.customer.phone,
        lastInteractionAt: o.lastInteractionAt.toISOString(),
        ownerName: o.owner?.name ?? null,
        ownerColor: o.owner?.color ?? "#94a3b8",
        tags: o.customer.tags.map((t) => ({
          name: t.tag.name,
          color: t.tag.color,
        })),
        nextTask: o.tasks[0]
          ? { title: o.tasks[0].title, dueAt: o.tasks[0].dueAt.toISOString() }
          : null,
        lostReason: o.lostReason,
      })),
  }));

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Funil de vendas"
        subtitle="Arraste os cards entre as etapas para atualizar a negociação."
      />
      <FunnelBoard initialStages={stages} customers={customers} />
    </div>
  );
}
