import { after } from "next/server";
import { PageHeader } from "@/components/ui";
import { diaSP } from "@/lib/dia";
import { porteiraCalendarioTela } from "@/lib/calendario/gate";
import { carregarCalendario, intervaloDaTela } from "@/lib/calendario/dados";
import { avisarCalendarioSeDevido } from "@/lib/calendario/lembrete";
import { DATA_DO_SISTEMA_POR_CHAVE, SEGMENTOS } from "@/lib/calendario/datas";
import { CalendarioView } from "./calendario-view";

export const dynamic = "force-dynamic";

/**
 * CALENDÁRIO COMERCIAL (RN-092). Só gerência, só com a chave do módulo
 * (porteira). Mostra do mês corrente até 12 meses à frente: as datas
 * comerciais, as de oportunidade dos segmentos da loja e os lançamentos.
 * Ao abrir, dá a carona do lembrete "é hora de começar".
 */
export default async function CalendarioPage() {
  const user = await porteiraCalendarioTela();
  after(() => avisarCalendarioSeDevido(user.companyId, { aoAbrirATela: true }));
  const hoje = diaSP(new Date());
  const { de, ate } = intervaloDaTela(hoje);
  const { config, ocorrencias } = await carregarCalendario(user.companyId, de, ate);
  const ocultas = config.ocultas
    .map((chave) => ({ chave, titulo: DATA_DO_SISTEMA_POR_CHAVE.get(chave)?.data.titulo ?? null }))
    .filter((o): o is { chave: string; titulo: string } => o.titulo !== null);

  return (
    <div>
      <PageHeader
        title="Calendário comercial"
        subtitle="As datas que vendem, as do seu segmento e os seus lançamentos — com o aviso na hora de começar a se preparar."
      />
      <CalendarioView
        hoje={hoje}
        antecedenciaDias={config.antecedenciaDias}
        segmentosDaLoja={config.segmentos}
        ocultas={ocultas}
        ocorrencias={ocorrencias}
        segmentos={SEGMENTOS.map((s) => ({
          chave: s.chave,
          nome: s.nome,
          datas: s.datas.map((d) => d.titulo),
        }))}
      />
    </div>
  );
}
