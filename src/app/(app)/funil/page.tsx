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

  // ---- Pedido enviado (por oportunidade) e carrinho abandonado (por cliente) ----
  // para abrir no card do funil: o que o cliente colocou na sacola ou já pediu.
  const oppIds = opps.map((o) => o.id);
  const customerIds = [...new Set(opps.map((o) => o.customerId))];

  const linkedOrders = await db.order.findMany({
    where: { companyId: user.companyId, opportunityId: { in: oppIds } },
    include: { items: true },
  });
  const orderByOpp = new Map(linkedOrders.map((o) => [o.opportunityId!, o]));

  // sessão mais recente NÃO convertida com itens na sacola, por cliente
  const cartSessions = await db.trackSession.findMany({
    where: {
      companyId: user.companyId,
      customerId: { in: customerIds },
      converted: false,
      cartValue: { gt: 0 },
    },
    orderBy: { startedAt: "desc" },
  });
  const latestCartByCustomer = new Map<string, (typeof cartSessions)[number]>();
  for (const s of cartSessions) {
    if (s.customerId && !latestCartByCustomer.has(s.customerId)) {
      latestCartByCustomer.set(s.customerId, s);
    }
  }
  const cartEvents = await db.trackEvent.findMany({
    where: {
      sessionId: { in: [...latestCartByCustomer.values()].map((s) => s.id) },
      type: { in: ["cart_add", "cart_remove"] },
    },
    orderBy: { createdAt: "asc" },
  });
  // reconstrói a sacola de cada sessão (produto · cor · tam × qtd)
  const bagBySession = new Map<string, Map<string, number>>();
  for (const e of cartEvents) {
    const key = [e.productName, e.color, e.size].filter(Boolean).join(" · ");
    if (!key) continue;
    const bag = bagBySession.get(e.sessionId) ?? new Map<string, number>();
    bag.set(key, (bag.get(key) ?? 0) + (e.qty ?? 1) * (e.type === "cart_add" ? 1 : -1));
    bagBySession.set(e.sessionId, bag);
  }
  const cartByCustomer = new Map<string, { value: number; items: string[] }>();
  for (const [cid, s] of latestCartByCustomer) {
    const bag = bagBySession.get(s.id);
    const items = bag
      ? [...bag.entries()].filter(([, q]) => q > 0).map(([k, q]) => `${q}× ${k}`)
      : [];
    cartByCustomer.set(cid, { value: s.cartValue, items });
  }

  const stages: BoardStage[] = pipeline.stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    isWon: s.isWon,
    isLost: s.isLost,
    cards: opps
      .filter((o) => o.stageId === s.id)
      .map((o) => {
        const ord = orderByOpp.get(o.id);
        const cart = ord ? null : cartByCustomer.get(o.customerId) ?? null;
        return {
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
          order: ord
            ? {
                id: ord.id,
                number: ord.number,
                status: ord.status,
                total: ord.total,
                items: ord.items.map((it) => ({
                  name: it.name,
                  variant: [it.color, it.size].filter(Boolean).join(" · "),
                  quantity: it.quantity,
                  unitPrice: it.unitPrice,
                })),
              }
            : null,
          cart: cart && (cart.items.length > 0 || cart.value > 0) ? cart : null,
        };
      }),
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
