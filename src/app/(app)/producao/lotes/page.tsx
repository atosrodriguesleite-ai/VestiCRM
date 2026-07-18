import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { norm } from "@/lib/nuvemshop";
import {
  LotesView,
  type LoteRow,
  type PoolSku,
  type FaccaoRow,
  type DefeitoRow,
} from "./lotes-view";

export const dynamic = "force-dynamic";

export default async function LotesPage() {
  const user = await requireUser();
  const [batches, pool, faccoes, defeitos] = await Promise.all([
    db.sewingBatch.findMany({
      where: { companyId: user.companyId },
      include: { items: true, faction: true },
      orderBy: { code: "desc" },
      take: 200,
    }),
    db.sewingItem.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "asc" },
    }),
    db.sewingFaction.findMany({
      where: { companyId: user.companyId, active: true },
      orderBy: { name: "asc" },
    }),
    db.defectItem.findMany({
      where: { companyId: user.companyId, status: { in: ["AGUARDANDO", "EM_CONSERTO"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  // pool agrupado por SKU (o que está na costura, disponível pra lote)
  const grupos = new Map<string, PoolSku>();
  for (const i of pool) {
    const rest = i.cutPieces - i.donePieces;
    if (rest <= 0) continue;
    const key = `${norm(i.productName)}|${norm(i.color)}|${norm(i.size)}`;
    const g =
      grupos.get(key) ??
      ({ productName: i.productName, color: i.color, size: i.size, disponivel: 0 } as PoolSku);
    g.disponivel += rest;
    grupos.set(key, g);
  }

  const rows: LoteRow[] = batches.map((b) => ({
    id: b.id,
    code: b.code,
    kind: b.kind,
    destination: b.destination,
    factionName: b.faction?.name ?? null,
    status: b.status,
    sentAt: b.sentAt.toISOString(),
    closedAt: b.closedAt?.toISOString() ?? null,
    notes: b.notes,
    items: b.items.map((i) => ({
      id: i.id,
      productName: i.productName,
      color: i.color,
      size: i.size,
      sent: i.sent,
      good: i.good,
      defect: i.defect,
    })),
  }));

  const abertos = rows.filter((r) => r.status !== "FECHADO").length;

  return (
    <div>
      <PageHeader
        title="Lotes de costura"
        subtitle={`Romaneios rastreáveis: ${abertos} lote(s) fora (interna ou facção). Enviado × devolvido, com etiqueta e conferência de volta.`}
      />
      <LotesView
        lotes={rows}
        pool={[...grupos.values()]}
        faccoes={faccoes.map((f): FaccaoRow => ({ id: f.id, name: f.name, pricePerPiece: f.pricePerPiece }))}
        defeitos={defeitos.map(
          (d): DefeitoRow => ({
            id: d.id,
            productName: d.productName,
            color: d.color,
            size: d.size,
            pieces: d.pieces,
            status: d.status,
          })
        )}
      />
    </div>
  );
}
