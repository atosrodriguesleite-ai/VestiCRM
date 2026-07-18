import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CortesView, type CorteRow, type RollOption, type ProdSettings } from "./cortes-view";

export const dynamic = "force-dynamic";

export default async function CortesPage() {
  const user = await requireUser();

  const [cortes, rolls, settings] = await Promise.all([
    db.cutTicket.findMany({
      where: { companyId: user.companyId },
      include: {
        roll: { include: { fabric: true } },
        occurrences: { orderBy: { createdAt: "asc" } },
        scraps: { select: { id: true } },
      },
      orderBy: { code: "desc" },
      take: 200,
    }),
    db.fabricRoll.findMany({
      where: { fabric: { companyId: user.companyId, active: true }, remainingKg: { gt: 0 } },
      include: { fabric: true },
      orderBy: { arrivedAt: "desc" },
    }),
    db.productionSettings.findUnique({ where: { companyId: user.companyId } }),
  ]);

  const parse = <T,>(s: string | undefined, fallback: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const prodSettings: ProdSettings = {
    tables: parse(settings?.tables, []),
    operators: parse(settings?.operators, []),
    occurrenceTypes: parse(settings?.occurrenceTypes, [
      "Furo", "Mancha", "Defeito", "Falta de largura", "Rasgo", "Borda ruim", "Torção", "Outro",
    ]),
    costItems: parse(settings?.costItems, []),
  };

  const rows: CorteRow[] = cortes.map((c) => ({
    id: c.id,
    code: c.code,
    status: c.status,
    date: c.date.toISOString(),
    operator: c.operator,
    tableName: c.tableName,
    tableLengthM: c.tableLengthM,
    plannedKg: c.plannedKg,
    usedKg: c.usedKg,
    planName: c.planName,
    productName: c.productName,
    gradeInfo: c.gradeInfo,
    lengthM: c.lengthM,
    sheets: c.sheets,
    piecesFirst: c.piecesFirst,
    predictedTotal: c.predictedTotal,
    predictedMin: c.predictedMin,
    predictedMax: c.predictedMax,
    predictedBasis: c.predictedBasis,
    piecesRest: c.piecesRest,
    piecesTotal: c.piecesTotal,
    errorPieces: c.errorPieces,
    fabricCost: c.fabricCost,
    costItems: parse(c.costItems, []),
    costPerPiece: c.costPerPiece,
    notes: c.notes,
    fabricName: c.roll?.fabric.name ?? "—",
    fabricColor: c.roll?.color ?? "—",
    yieldMPerKg: c.roll?.fabric.yieldMPerKg ?? 0,
    occurrences: c.occurrences.map((o) => ({
      id: o.id,
      type: o.type,
      description: o.description,
      lostKg: o.lostKg,
    })),
    sobras: c.scraps.length,
  }));

  const rollOptions: RollOption[] = rolls.map((r) => ({
    id: r.id,
    fabricName: r.fabric.name,
    color: r.color,
    remainingKg: r.remainingKg,
    yieldMPerKg: r.fabric.yieldMPerKg,
    pricePerKg: r.pricePerKg,
  }));

  return (
    <div>
      <PageHeader
        title="Cortes"
        subtitle="Cada corte fechado ensina o motor de projeção — as previsões ficam mais precisas a cada registro."
      />
      <CortesView cortes={rows} rolls={rollOptions} settings={prodSettings} />
    </div>
  );
}
