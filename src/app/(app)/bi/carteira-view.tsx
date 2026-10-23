import Link from "next/link";
import { Card, Avatar, EmptyState } from "@/components/ui";
import { brl } from "@/lib/format";
import { FAIXAS, type Carteira } from "@/lib/bi/carteira";
import type { Rfm } from "@/lib/bi/rfm";
import { RfmView } from "./rfm-view";

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

/**
 * A ABA CLIENTES: o RFM da loja (RN-093) em cima — os oito grupos e a matriz
 * —, e embaixo a carteira pela MESMA régua da aba Recompra (RN-084: faixa,
 * ritmo, VIP), as VIPs que esfriaram e as melhores clientes do período.
 */
export function CarteiraView({ dados, rfm, dias }: { dados: Carteira; rfm: Rfm; dias: number }) {
  const { resumo, melhoresDoPeriodo } = dados;
  const faixaDe = (id: string | null) => FAIXAS.find((f) => f.id === id);
  const maiorDoPeriodo = Math.max(...melhoresDoPeriodo.map((m) => m.total), 1);

  if (resumo.compradoras === 0) {
    return (
      <Card className="p-5">
        <EmptyState title="Nenhuma cliente com compra paga ainda" hint="A carteira nasce com o primeiro pedido pago." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RfmView rfm={rfm} periodo={dados.periodo} />

      <h2 className="font-semibold pt-2">A carteira</h2>
      <p className="text-xs text-gray-400 -mt-3">
        A faixa (ativa, esfriando, em risco, sumida), o ritmo e o selo VIP são os MESMOS da aba Recompra — a vida
        inteira da cliente. Só «Melhores do período» olha o período escolhido ({dias} dias).
      </p>

      {/* OS NÚMEROS DA CARTEIRA */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-gray-400">Clientes que já compraram</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">{resumo.compradoras}</p>
          <p className="text-[11px] text-gray-400 mt-1">{resumo.recorrentes} com 2+ compras</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Taxa de recompra</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">{pct(resumo.taxaRecompraPct)}</p>
          <p className="text-[11px] text-gray-400 mt-1">a mesma conta do painel e da aba Recompra</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Passaram do próprio ritmo</p>
          <p className={`text-2xl font-semibold tabular-nums mt-1 ${resumo.passouDoPonto > 0 ? "text-amber-600" : ""}`}>{resumo.passouDoPonto}</p>
          <p className="text-[11px] text-gray-400 mt-1">{brl(resumo.valorEmRisco)} na mesa (uma compra média de cada)</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Concentração nas VIPs</p>
          <p className="text-2xl font-semibold tabular-nums mt-1">{pct(resumo.concentracaoVipPct)}</p>
          <p className="text-[11px] text-gray-400 mt-1">do total histórico vem do Top 20</p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* VIPs QUE ESFRIARAM */}
        <Card className="p-5 min-w-0">
          <h2 className="font-semibold mb-1">VIPs que esfriaram</h2>
          <p className="text-xs text-gray-400 mb-3">
            Do Top 20 de quem mais comprou na vida, quem saiu da faixa Ativa (esfriando, em risco ou sumida). É a
            ligação mais valiosa da semana — a aba Recompra tem a mensagem pronta.
          </p>
          {resumo.vipsEsfriando.length === 0 ? (
            <EmptyState title="Todas as VIPs estão ativas 🎉" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {resumo.vipsEsfriando.map((c) => {
                const f = faixaDe(c.faixa);
                return (
                  <li key={c.id} className="py-2 flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-400 w-6 tabular-nums">#{c.vip}</span>
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/clientes/${c.id}`} className="font-medium truncate block hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-[11px] text-gray-400">
                        {c.compras} compras · {brl(c.total)} · última há {c.diasDesde} dias
                      </p>
                    </div>
                    {f && (
                      <span className="text-[11px] font-medium rounded-full px-2 py-0.5" style={{ color: f.cor, background: `${f.cor}1a` }}>
                        {f.rotulo}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* MELHORES DO PERÍODO */}
        <Card className="p-5 min-w-0">
          <h2 className="font-semibold mb-1">Melhores do período</h2>
          <p className="text-xs text-gray-400 mb-3">
            Quem mais comprou nos {dias} dias (pela data do pagamento, sem o frete): {brl(dados.vendidoNoPeriodo)} no
            total.
          </p>
          {melhoresDoPeriodo.length === 0 ? (
            <EmptyState title="Nenhuma venda paga no período" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {melhoresDoPeriodo.map((m, i) => {
                const f = faixaDe(m.faixa);
                return (
                  <li key={m.id} className="py-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-400 w-5 tabular-nums">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/clientes/${m.id}`} className="font-medium truncate block hover:underline">
                          {m.nome}
                          {m.vip != null && <span className="ml-1.5 text-[10px] text-amber-600 font-semibold">VIP #{m.vip}</span>}
                        </Link>
                        <p className="text-[11px] text-gray-400">
                          {m.pedidos} pedido{m.pedidos === 1 ? "" : "s"}
                          {f && <> · {f.rotulo}</>}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums shrink-0">{brl(m.total)}</span>
                    </div>
                    <div className="h-1 rounded-full bg-slate-100 overflow-hidden mt-1.5 ml-8">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max((m.total / maiorDoPeriodo) * 100, 2)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
