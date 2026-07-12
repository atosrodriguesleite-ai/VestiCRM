import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownedScope, isManagerUp } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { FunnelBoard, type BoardStage } from "./funnel-board";
import { QuickLeadLink } from "@/components/quick-lead-link";
import { trackedLinkParts } from "@/lib/catalog-url";

export const dynamic = "force-dynamic";

const SP_OFFSET = 3 * 60 * 60 * 1000; // São Paulo é UTC-3 (sem horário de verão)

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  const scope = ownedScope(user);
  const funnelCompany = await db.company.findUnique({
    where: { id: user.companyId },
    select: { slug: true },
  });
  const { de, ate } = await searchParams;
  const from = de && !Number.isNaN(Date.parse(`${de}T00:00:00Z`))
    ? new Date(Date.parse(`${de}T00:00:00Z`) + SP_OFFSET)
    : null;
  const to = ate && !Number.isNaN(Date.parse(`${ate}T23:59:59.999Z`))
    ? new Date(Date.parse(`${ate}T23:59:59.999Z`) + SP_OFFSET)
    : null;

  const pipeline = await db.pipeline.findFirst({
    where: { companyId: user.companyId },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  if (!pipeline) {
    return <p className="text-sm text-gray-500">Nenhum funil configurado.</p>;
  }

  const opps = await db.opportunity.findMany({
    where: {
      ...scope,
      stageId: { in: pipeline.stages.map((s) => s.id) },
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
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
        action={
          <div className="flex items-end gap-2 flex-wrap">
            <QuickLeadLink {...trackedLinkParts(user, funnelCompany?.slug ?? "")} />
          <form className="flex items-end gap-2" method="GET">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
              <input type="date" name="de" defaultValue={de ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
              <input type="date" name="ate" defaultValue={ate ?? ""} className="rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white" />
            </div>
            <button className="rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition">
              Filtrar
            </button>
          </form>
          </div>
        }
      />
      <FunnelBoard initialStages={stages} customers={customers} canDelete={isManagerUp(user)} />
    </div>
  );
}
