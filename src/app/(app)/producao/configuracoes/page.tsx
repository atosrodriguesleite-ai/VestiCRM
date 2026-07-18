import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { ProducaoConfigView, type TecidoRow, type Ajustes } from "./config-view";

export const dynamic = "force-dynamic";

export default async function ProducaoConfigPage() {
  const user = await requireUser();
  const [fabrics, settings, faccoes] = await Promise.all([
    db.fabric.findMany({
      where: { companyId: user.companyId },
      include: { rolls: { orderBy: { arrivedAt: "desc" } } },
      orderBy: { name: "asc" },
    }),
    db.productionSettings.findUnique({ where: { companyId: user.companyId } }),
    db.sewingFaction.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
    }),
  ]);

  const parse = <T,>(s: string | undefined, fallback: T): T => {
    try {
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  const ajustes: Ajustes = {
    tables: parse(settings?.tables, []),
    operators: parse(settings?.operators, []),
    occurrenceTypes: parse(settings?.occurrenceTypes, [
      "Furo", "Mancha", "Defeito", "Falta de largura", "Rasgo", "Borda ruim", "Torção", "Outro",
    ]),
    costItems: parse(settings?.costItems, []),
  };

  const tecidos: TecidoRow[] = fabrics.map((f) => ({
    id: f.id,
    name: f.name,
    code: f.code,
    type: f.type,
    supplier: f.supplier,
    grammage: f.grammage,
    composition: f.composition,
    widthM: f.widthM,
    yieldMPerKg: f.yieldMPerKg,
    active: f.active,
    rolls: f.rolls.map((r) => ({
      id: r.id,
      color: r.color,
      lotCode: r.lotCode,
      weightKg: r.weightKg,
      remainingKg: r.remainingKg,
      pricePerKg: r.pricePerKg,
    })),
  }));

  return (
    <div>
      <PageHeader
        title="Configurações da Produção"
        subtitle="Tecidos, rolos, mesas, operadores, ocorrências e custos — tudo cadastrável, nada fixo."
      />
      <ProducaoConfigView
        tecidos={tecidos}
        ajustes={ajustes}
        faccoes={faccoes.map((f) => ({
          id: f.id,
          name: f.name,
          contact: f.contact,
          pricePerPiece: f.pricePerPiece,
          active: f.active,
        }))}
      />
    </div>
  );
}
