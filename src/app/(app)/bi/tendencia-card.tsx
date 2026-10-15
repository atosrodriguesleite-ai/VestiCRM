import { Card } from "@/components/ui";
import { SerieViva } from "@/components/grafico-vivo";
import { brl } from "@/lib/format";
import type { MesDaTendencia } from "@/lib/bi/tendencia";

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

/**
 * ÚLTIMOS 12 MESES (RN-087): contatos, vendas e atendimento mês a mês. O
 * mês sem fato de atendimento mostra "—" e a legenda diz desde quando o
 * tempo de resposta é contado.
 */
export function TendenciaCard({ meses }: { meses: MesDaTendencia[] }) {
  const primeiroComFato = meses.find((m) => m.diasComFato > 0);
  const labels = meses.map((m) => m.rotulo);
  return (
    <Card className="p-5">
      <h2 className="font-semibold mb-1">Últimos 12 meses</h2>
      <p className="text-xs text-gray-400 mb-4">
        Contatos novos, pedidos pagos e vendido por mês (pela data do pagamento, sem o frete), e o atendimento onde
        já há fatos{primeiroComFato ? ` — contado a partir de ${primeiroComFato.rotulo}` : ""}. Fora do filtro de período:
        é a tendência da loja.
      </p>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Contatos novos por mês</p>
          <SerieViva titulo="Contatos novos por mês" points={meses.map((m) => m.leads)} labels={labels} height={140} />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Vendido por mês</p>
          <SerieViva titulo="Vendido por mês" points={meses.map((m) => m.vendido)} labels={labels} height={140} formato="brl" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase bg-gray-50/70">
              <th className="px-3 py-2">Mês</th>
              <th className="px-3 py-2 text-right">Contatos</th>
              <th className="px-3 py-2 text-right">Pedidos pagos</th>
              <th className="px-3 py-2 text-right">Vendido</th>
              <th className="px-3 py-2 text-right">Ticket</th>
              <th className="px-3 py-2 text-right">No prazo</th>
              <th className="px-3 py-2 text-right">Sem resposta</th>
            </tr>
          </thead>
          <tbody>
            {[...meses].reverse().map((m) => {
              const parcial = m.diasComFato > 0 && m.diasComFato < m.diasNoMes;
              return (
                <tr key={m.mes} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">
                    {m.rotulo}
                    {parcial && <span className="text-[10px] text-gray-400 font-normal"> · atendimento em {m.diasComFato} de {m.diasNoMes} dias</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.leads}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.pedidosPagos}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{brl(m.vendido)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.ticket == null ? "—" : brl(m.ticket)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(m.pctNoPrazo)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${m.semResposta ? "text-rose-600" : ""}`}>{m.semResposta == null ? "—" : m.semResposta}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
