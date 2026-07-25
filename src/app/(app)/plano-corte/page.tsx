import { PageHeader } from "@/components/ui";
import { PlanoCorteView } from "./plano-corte-view";

export const dynamic = "force-dynamic";

/**
 * Plano de Corte Inteligente: importa o modelo do CAD (Audaces .adsx/DXF),
 * recebe grade + mesa + tecido e monta os riscos otimizados. Módulo pago à
 * parte, independente da Produção (a trava cutPlanEnabled está no layout).
 */
export default function PlanoCortePage() {
  return (
    <div>
      <PageHeader
        title="Plano de Corte Inteligente"
        subtitle="Suba o arquivo do Audaces, informe a grade e a mesa — o sistema testa várias estratégias e monta o plano que gasta menos tecido."
      />
      <PlanoCorteView />
    </div>
  );
}
