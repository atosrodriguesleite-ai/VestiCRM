import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { filaDeSeparacao, type PedidoNaFila } from "@/lib/etiquetas/separacao";
import { SeparacaoView } from "./separacao-view";

export const dynamic = "force-dynamic";

/** Datas viram texto ISO para atravessar a fronteira servidor → navegador. */
function paraTela(linhas: PedidoNaFila[]) {
  return linhas.map((l) => ({
    ...l,
    pagoEm: l.pagoEm?.toISOString() ?? null,
    separadoEm: l.separadoEm?.toISOString() ?? null,
    emAndamento: l.emAndamento ? { quem: l.emAndamento.quem, desde: l.emAndamento.desde.toISOString() } : null,
  }));
}

/** A FILA DE SEPARAÇÃO (RN-060). A chave do módulo já foi conferida no layout. */
export default async function SeparacaoPage() {
  const user = await requireUser();
  const fila = await filaDeSeparacao(user);
  return (
    <div>
      <PageHeader title="Separação" subtitle="Pedidos pagos esperando para ser separados. Abra um, bipe as peças com o leitor e conclua." />
      <SeparacaoView aSeparar={paraTela(fila.aSeparar)} separados={paraTela(fila.separados)} cortada={fila.cortada} />
    </div>
  );
}
