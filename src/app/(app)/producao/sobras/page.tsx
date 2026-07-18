import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { SobrasView, type SobraRow } from "./sobras-view";

export const dynamic = "force-dynamic";

export default async function SobrasPage() {
  const user = await requireUser();
  const sobras = await db.fabricScrap.findMany({
    where: { companyId: user.companyId },
    include: { cut: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  // genealogia: sobra consumida aponta pro corte que a reaproveitou
  const destinos = await db.cutTicket.findMany({
    where: { id: { in: sobras.map((s) => s.usedInCutId).filter((v): v is string => Boolean(v)) } },
    select: { id: true, code: true },
  });
  const codePorCorte = new Map(destinos.map((d) => [d.id, d.code]));

  const rows: SobraRow[] = sobras.map((s) => ({
    id: s.id,
    fabricName: s.fabricName,
    color: s.color,
    grammage: s.grammage,
    widthM: s.widthM,
    weightKg: s.weightKg,
    estimatedM: s.estimatedM,
    value: s.value,
    geometry: s.geometry,
    quality: s.quality,
    status: s.status,
    corteCode: s.cut?.code ?? null,
    usadaNoCorte: s.usedInCutId ? codePorCorte.get(s.usedInCutId) ?? null : null,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
  }));

  const disponiveis = rows.filter((r) => r.status === "DISPONIVEL");
  const kgDisp = disponiveis.reduce((a, r) => a + r.weightKg, 0);
  const valorDisp = disponiveis.reduce((a, r) => a + r.value, 0);

  return (
    <div>
      <PageHeader
        title="Estoque de Sobras"
        subtitle={`${disponiveis.length} sobra(s) disponíveis · ${kgDisp.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg · R$ ${valorDisp.toFixed(2).replace(".", ",")} parados em tecido`}
      />
      <SobrasView sobras={rows} />
    </div>
  );
}
