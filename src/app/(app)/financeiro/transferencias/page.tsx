import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { diaSP } from "@/lib/financeiro/lancamentos";
import { TransferenciasView } from "./transferencias-view";

export const dynamic = "force-dynamic";

/** TRANSFERÊNCIAS (RN-030) — dinheiro entre contas da própria loja. */
export default async function TransferenciasPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");

  const [contas, transferencias] = await Promise.all([
    db.finConta.findMany({
      where: { companyId: user.companyId, arquivadaEm: null, tipo: { not: "CARTAO" } },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true },
    }),
    db.finTransferencia.findMany({
      where: { companyId: user.companyId },
      orderBy: { dataSaida: "desc" },
      take: 200,
      include: {
        contaOrigem: { select: { nome: true } },
        contaDestino: { select: { nome: true } },
      },
    }),
  ]);

  return (
    <TransferenciasView
      hoje={diaSP(new Date())}
      contas={contas}
      transferencias={transferencias.map((t) => ({
        id: t.id,
        valor: t.valor,
        dataSaida: diaSP(t.dataSaida),
        dataEntrada: diaSP(t.dataEntrada),
        origem: t.contaOrigem.nome,
        destino: t.contaDestino.nome,
        descricao: t.descricao,
        autorNome: t.autorNome,
        cancelada: Boolean(t.canceladaEm),
        canceladaPor: t.canceladaPor,
      }))}
    />
  );
}
