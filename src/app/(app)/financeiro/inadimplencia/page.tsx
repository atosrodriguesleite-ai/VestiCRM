import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { financeiroLiberado } from "@/lib/financeiro/gate";
import { carregarInadimplencia } from "@/lib/financeiro/visao";
import { InadimplenciaView } from "./inadimplencia-view";

export const dynamic = "force-dynamic";

/**
 * INADIMPLÊNCIA (RN-034) — quem está devendo, do mais atrasado para o menos,
 * com a cobrança saindo pela Central de Atendimento que a loja já usa.
 */
export default async function InadimplenciaPage() {
  const user = await requireUser();
  if (!isManagerUp(user)) redirect("/dashboard");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { financeEnabled: true },
  });
  if (!financeiroLiberado(user, company?.financeEnabled ?? false))
    redirect("/financeiro");

  const { linhas, total, clientes, truncado } = await carregarInadimplencia(
    user.companyId
  );
  return (
    <InadimplenciaView
      linhas={linhas}
      total={total}
      clientes={clientes}
      truncado={truncado}
    />
  );
}
