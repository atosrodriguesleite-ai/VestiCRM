import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { CosturaView, type CosturaRow } from "./costura-view";

export const dynamic = "force-dynamic";

export default async function CosturaPage() {
  const user = await requireUser();
  const itens = await db.sewingItem.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows: CosturaRow[] = itens.map((i) => ({
    id: i.id,
    cutCode: i.cutCode,
    productName: i.productName,
    color: i.color,
    size: i.size,
    cutPieces: i.cutPieces,
    donePieces: i.donePieces,
    createdAt: i.createdAt.toISOString(),
  }));

  const aMontar = rows.reduce((a, r) => a + (r.cutPieces - r.donePieces), 0);

  return (
    <div>
      <PageHeader
        title="Estoque de Costura"
        subtitle={`${aMontar} peça(s) cortadas aguardando montagem — ainda NÃO estão no estoque de venda. Montou e conferiu? Lance aqui: entra no estoque real (e na loja online) e baixa da costura.`}
      />
      <CosturaView itens={rows} />
    </div>
  );
}
