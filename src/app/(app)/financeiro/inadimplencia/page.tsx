import { porteiraFinanceiroTela } from "@/lib/financeiro/gate";
import { carregarInadimplencia } from "@/lib/financeiro/visao";
import { InadimplenciaView } from "./inadimplencia-view";

export const dynamic = "force-dynamic";

/**
 * INADIMPLÊNCIA (RN-034) — quem está devendo, do mais atrasado para o menos,
 * com a cobrança saindo pela Central de Atendimento que a loja já usa.
 */
export default async function InadimplenciaPage() {
  const user = await porteiraFinanceiroTela();

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
