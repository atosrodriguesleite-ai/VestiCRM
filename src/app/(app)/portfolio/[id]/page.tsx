import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { ensurePlatformCompany } from "@/lib/platform";
import { ProdutoView, type ProdutoDoc } from "./produto-view";

export const dynamic = "force-dynamic";

/**
 * Página de um produto do portfólio (só Super Admin).
 * Reúne, num documento só, o que vender e como entregar.
 */
export default async function ProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  const { id } = await params;
  const companyId = await ensurePlatformCompany();
  const p = await db.portfolioProduct.findFirst({
    where: { id, companyId },
    include: {
      variants: { orderBy: { order: "asc" } },
      positions: { orderBy: { order: "asc" } },
      dreLines: { orderBy: { order: "asc" } },
      steps: { orderBy: { order: "asc" } },
      materials: { orderBy: { order: "asc" } },
      salesFrames: {
        orderBy: { order: "asc" },
        include: { rows: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!p) notFound();

  const doc: ProdutoDoc = {
    id: p.id,
    name: p.name,
    shortDesc: p.shortDesc ?? "",
    category: p.category ?? "",
    status: p.status,
    duration: p.duration ?? "",
    baseValue: p.baseValue,
    ownerName: p.ownerName ?? "",
    fullDesc: p.fullDesc ?? "",
    icpText: p.icpText ?? "",
    icpForWhom: p.icpForWhom ?? "",
    icpHowValue: p.icpHowValue ?? "",
    scope: p.scope ?? "",
    deliveryFormat: p.deliveryFormat ?? "",
    teamInvolved: p.teamInvolved ?? "",
    howToSell: p.howToSell ?? "",
    howToDeliver: p.howToDeliver ?? "",
    notes: p.notes ?? "",
    variants: p.variants.map((v) => ({
      name: v.name,
      baseValue: v.baseValue,
      description: v.description ?? "",
    })),
    positions: p.positions.map((x) => ({
      role: x.role,
      hours: x.hours,
      cost: x.cost,
      note: x.note ?? "",
    })),
    dreLines: p.dreLines.map((l) => ({
      label: l.label,
      sign: l.sign,
      percent: l.percent,
      value: l.value,
      highlight: l.highlight,
    })),
    steps: p.steps.map((s) => ({
      stage: s.stage ?? "",
      task: s.task,
      detail: s.detail ?? "",
      executor: s.executor ?? "",
      estimate: s.estimate ?? "",
      popUrl: s.popUrl ?? "",
    })),
    materials: p.materials.map((m) => ({
      kind: m.kind,
      title: m.title,
      tag: m.tag ?? "",
      url: m.url ?? "",
    })),
    salesFrames: p.salesFrames.map((f) => ({
      title: f.title,
      subtitle: f.subtitle ?? "",
      colA: f.colA ?? "",
      colB: f.colB ?? "",
      colC: f.colC ?? "",
      rows: f.rows.map((r) => ({
        label: r.label,
        valueA: r.valueA ?? "",
        valueB: r.valueB ?? "",
        valueC: r.valueC ?? "",
      })),
    })),
  };

  return <ProdutoView doc={doc} />;
}
