"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  TrendingUp,
  Wallet,
  Users,
  Activity,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { Card } from "@/components/ui";
import { brl, dateShort, timeShort } from "@/lib/format";
import { cicloLabel, lifetimeLabel, situacaoLabel, canalLeadLabel, type CanalDeLead, type SituacaoCobranca } from "@/lib/gestao";

export type LojaGestao = {
  id: string;
  nome: string;
  slug: string;
  responsavel: string | null;
  email: string | null;
  criadaEm: string;
  lifetimeMeses: number;
  suspensa: boolean;
  kind: string;
  cycle: string;
  monthlyFee: number;
  valorCobranca: number;
  implementationFee: number;
  implementationPaid: boolean;
  dueDay: number;
  situacao: SituacaoCobranca;
  jaGerou: number;
  faturamentoMes: number;
  pedidosPagosMes: number;
  faturamentoMesAnterior: number;
  pedidosGeradosMes: number;
  usuarios: number;
  clientes: number;
  produtos: number;
  ultimoAcesso: string | null;
  emRisco: boolean;
  whatsapp: string;
  whatsappPhone: string | null;
  notas: string | null;
};

export type Intercorrencia = {
  id: string;
  origem: string;
  caminho: string | null;
  mensagem: string;
  detalhe: string | null;
  quando: string;
};

type Resumo = {
  mrr: number;
  recebidoMes: number;
  recebidoImplantacaoMes: number;
  recebidoMesAnterior: number;
  aReceberImplantacao: number;
  faturamentoLojasMes: number;
  pedidosLojasMes: number;
  lojasAtivas: number;
  lojasPagantes: number;
  lojasTeste: number;
  lojasSuspensas: number;
  emRisco: number;
  atrasados: number;
  ltMedio: number;
};

type Aba = "visao" | "lojas" | "financeiro" | "leads" | "sistema";

const ABAS: { id: Aba; label: string; icon: typeof Building2 }[] = [
  { id: "visao", label: "Visão geral", icon: TrendingUp },
  { id: "lojas", label: "Lojas", icon: Building2 },
  { id: "financeiro", label: "Financeiro", icon: Wallet },
  { id: "leads", label: "Leads", icon: Users },
  { id: "sistema", label: "Sistema", icon: Activity },
];

const tomSituacao: Record<SituacaoCobranca, string> = {
  EM_DIA: "bg-emerald-50 text-emerald-700 border-emerald-200",
  A_VENCER: "bg-amber-50 text-amber-700 border-amber-200",
  ATRASADO: "bg-rose-50 text-rose-700 border-rose-200",
  SEM_COBRANCA: "bg-slate-100 text-slate-500 border-slate-200",
};
const tomKind: Record<string, string> = {
  PAGANTE: "bg-brand-50 text-brand-700 border-brand-200",
  TESTE: "bg-sky-50 text-sky-700 border-sky-200",
  CORTESIA: "bg-violet-50 text-violet-700 border-violet-200",
};

/** Cartão de indicador com variação opcional contra o período anterior. */
function Kpi({
  label,
  valor,
  hint,
  anterior,
  destaque,
}: {
  label: string;
  valor: string;
  hint?: string;
  anterior?: number;
  destaque?: boolean;
}) {
  const atual = Number(String(valor).replace(/[^\d,-]/g, "").replace(",", ".")) || 0;
  const temComparativo = anterior !== undefined && anterior > 0;
  const delta = temComparativo ? Math.round(((atual - anterior) / anterior) * 100) : 0;
  return (
    <div className={`rounded-2xl p-4 ${destaque ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-100"}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${destaque ? "text-white/70" : "text-slate-400"}`}>
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${destaque ? "text-white" : "text-slate-900"}`}>
        {valor}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {temComparativo && (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
              delta >= 0
                ? destaque ? "text-emerald-200" : "text-emerald-600"
                : destaque ? "text-rose-200" : "text-rose-600"
            }`}
          >
            {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta)}%
          </span>
        )}
        {hint && (
          <span className={`text-[11px] ${destaque ? "text-white/70" : "text-slate-400"}`}>{hint}</span>
        )}
      </div>
    </div>
  );
}

export function GestaoView({
  lojas,
  canais,
  intercorrencias,
  resumo,
}: {
  lojas: LojaGestao[];
  canais: Record<CanalDeLead, { total: number; mes: number; dias30: number }>;
  intercorrencias: Intercorrencia[];
  resumo: Resumo;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>("visao");
  const [busca, setBusca] = useState("");
  const [excluindo, setExcluindo] = useState<LojaGestao | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [erroExcluir, setErroExcluir] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lojas;
    return lojas.filter(
      (l) =>
        l.nome.toLowerCase().includes(q) ||
        l.slug.toLowerCase().includes(q) ||
        (l.responsavel ?? "").toLowerCase().includes(q)
    );
  }, [lojas, busca]);

  const ranking = useMemo(
    () => [...lojas].sort((a, b) => b.faturamentoMes - a.faturamentoMes).slice(0, 8),
    [lojas]
  );

  async function excluirLoja() {
    if (!excluindo || ocupado) return;
    setOcupado(true);
    setErroExcluir("");
    const res = await fetch("/api/companies/excluir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: excluindo.id, confirmacao }),
    });
    const d = await res.json().catch(() => ({}));
    setOcupado(false);
    if (res.ok) {
      setExcluindo(null);
      setConfirmacao("");
      router.refresh();
    } else {
      setErroExcluir(d.error ?? "Não foi possível excluir.");
    }
  }

  async function salvarCiclo(loja: LojaGestao, cycle: string) {
    setSalvandoId(loja.id);
    await fetch("/api/companies/billing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: loja.id, cycle }),
    });
    setSalvandoId(null);
    router.refresh();
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* cabeçalho + abas */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Painel de Gestão</h1>
        <p className="text-sm text-slate-500">
          A plataforma inteira num lugar só — dinheiro, clientes, leads e saúde do sistema.
        </p>
      </div>
      <div className="mb-5 flex gap-1.5 overflow-x-auto thin-scroll pb-1">
        {ABAS.map((a) => {
          const Icon = a.icon;
          const ativa = aba === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setAba(a.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                ativa
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-brand-700"
              }`}
            >
              <Icon className="size-4" />
              {a.label}
              {a.id === "sistema" && intercorrencias.length > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${ativa ? "bg-white/20" : "bg-rose-100 text-rose-700"}`}>
                  {intercorrencias.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---------------- VISÃO GERAL ---------------- */}
      {aba === "visao" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Receita recorrente (MRR)" valor={brl(resumo.mrr)} hint="mensalidades ativas" destaque />
            <Kpi
              label="Recebido no mês"
              valor={brl(resumo.recebidoMes)}
              anterior={resumo.recebidoMesAnterior}
              hint="vs. mês anterior"
            />
            <Kpi label="Lojas ativas" valor={String(resumo.lojasAtivas)} hint={`${resumo.lojasPagantes} pagantes · ${resumo.lojasTeste} em teste`} />
            <Kpi label="Tempo médio de casa" valor={`${resumo.ltMedio} m`} hint="lifetime médio das lojas" />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Faturamento das lojas"
              valor={brl(resumo.faturamentoLojasMes)}
              hint={`${resumo.pedidosLojasMes} pedidos pagos no mês`}
            />
            <Kpi label="Implantação a receber" valor={brl(resumo.aReceberImplantacao)} hint="ainda não pago" />
            <Kpi label="Cobranças atrasadas" valor={String(resumo.atrasados)} hint="pagantes vencidos" />
            <Kpi label="Lojas em risco" valor={String(resumo.emRisco)} hint="pagante sem uso há 14+ dias" />
          </div>

          {/* alertas que pedem ação */}
          {(resumo.atrasados > 0 || resumo.emRisco > 0 || resumo.lojasSuspensas > 0) && (
            <Card className="p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <ShieldAlert className="size-4 text-amber-500" />
                Precisa da sua atenção
              </p>
              <div className="space-y-2">
                {lojas
                  .filter((l) => l.situacao === "ATRASADO" || l.emRisco || l.suspensa)
                  .slice(0, 8)
                  .map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                      <span className="font-medium text-slate-800">{l.nome}</span>
                      {l.situacao === "ATRASADO" && (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                          cobrança atrasada · {brl(l.monthlyFee)}
                        </span>
                      )}
                      {l.emRisco && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          sem uso {l.ultimoAcesso ? `desde ${dateShort(l.ultimoAcesso)}` : "— nunca entrou"}
                        </span>
                      )}
                      {l.suspensa && (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          suspensa
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {/* ranking de movimento */}
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">Lojas que mais venderam no mês</p>
            {ranking.every((l) => l.faturamentoMes === 0) ? (
              <p className="py-6 text-center text-sm text-slate-400">
                Nenhuma venda registrada neste mês ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {ranking.map((l) => {
                  const maior = ranking[0].faturamentoMes || 1;
                  const pct = Math.round((l.faturamentoMes / maior) * 100);
                  return (
                    <div key={l.id} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-sm text-slate-700">{l.nome}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800">
                        {brl(l.faturamentoMes)}
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-400">
                        {l.pedidosPagosMes} ped.
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---------------- LOJAS ---------------- */}
      {aba === "lojas" && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar loja, endereço ou responsável…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
            />
          </div>

          <div className="grid gap-3">
            {filtradas.map((l) => (
              <Card key={l.id} className={`p-4 ${l.suspensa ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{l.nome}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tomKind[l.kind] ?? tomKind.TESTE}`}>
                        {l.kind === "PAGANTE" ? "Pagante" : l.kind === "TESTE" ? "Teste" : "Cortesia"}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tomSituacao[l.situacao]}`}>
                        {situacaoLabel[l.situacao]}
                      </span>
                      {l.suspensa && (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          suspensa
                        </span>
                      )}
                      {l.emRisco && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          em risco
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {l.responsavel ?? "sem responsável"} · cliente há <b>{lifetimeLabel(l.lifetimeMeses)}</b> (desde{" "}
                      {dateShort(l.criadaEm)})
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      href={`/lojas`}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-brand-300 hover:text-brand-700"
                    >
                      <ExternalLink className="size-3.5" />
                    </Link>
                    <button
                      onClick={() => {
                        setExcluindo(l);
                        setConfirmacao("");
                        setErroExcluir("");
                      }}
                      title="Excluir loja"
                      className="rounded-lg border border-slate-200 p-2 text-slate-400 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Faturou no mês</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-800">{brl(l.faturamentoMes)}</p>
                    {l.faturamentoMesAnterior > 0 && (
                      <p className="text-[10px] text-slate-400">antes {brl(l.faturamentoMesAnterior)}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Pedidos pagos</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-800">{l.pedidosPagosMes}</p>
                    <p className="text-[10px] text-slate-400">{l.pedidosGeradosMes} gerados</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Mensalidade</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-800">{brl(l.monthlyFee)}</p>
                    <p className="text-[10px] text-slate-400">vence dia {l.dueDay}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Plano</p>
                    <select
                      value={l.cycle}
                      disabled={salvandoId === l.id}
                      onChange={(e) => salvarCiclo(l, e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-xs outline-none focus:border-brand-400 disabled:opacity-50"
                    >
                      <option value="MENSAL">Mensal</option>
                      <option value="SEMESTRAL">Semestral</option>
                      <option value="ANUAL">Anual</option>
                    </select>
                    {l.cycle !== "MENSAL" && (
                      <p className="text-[10px] text-slate-400">{brl(l.valorCobranca)}/cobrança</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Já gerou</p>
                    <p className="text-sm font-semibold tabular-nums text-emerald-700">{brl(l.jaGerou)}</p>
                    <p className="text-[10px] text-slate-400">desde o início</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Uso</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-800">
                      {l.usuarios} <span className="text-xs font-normal text-slate-400">usuários</span>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {l.ultimoAcesso ? `visto ${dateShort(l.ultimoAcesso)}` : "nunca entrou"}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
            {filtradas.length === 0 && (
              <Card className="p-8 text-center text-sm text-slate-400">Nenhuma loja encontrada.</Card>
            )}
          </div>
        </div>
      )}

      {/* ---------------- FINANCEIRO ---------------- */}
      {aba === "financeiro" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="MRR" valor={brl(resumo.mrr)} hint="recorrência ativa" destaque />
            <Kpi label="Recebido no mês" valor={brl(resumo.recebidoMes)} anterior={resumo.recebidoMesAnterior} />
            <Kpi label="Implantação no mês" valor={brl(resumo.recebidoImplantacaoMes)} hint="entrada única" />
            <Kpi label="Implantação a receber" valor={brl(resumo.aReceberImplantacao)} hint="ainda em aberto" />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/70 text-left text-[11px] font-semibold uppercase text-slate-500">
                    <th className="px-4 py-3">Loja</th>
                    <th className="px-4 py-3">Plano</th>
                    <th className="px-4 py-3 text-right">Implantação</th>
                    <th className="px-4 py-3 text-right">Recorrência</th>
                    <th className="px-4 py-3 text-right">Já gerou</th>
                    <th className="px-4 py-3 text-center">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {lojas.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{l.nome}</p>
                        <p className="text-[11px] text-slate-400">
                          cliente há {lifetimeLabel(l.lifetimeMeses)}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{cicloLabel[l.cycle] ?? l.cycle}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {brl(l.implementationFee)}
                        <span className={`ml-1.5 text-[10px] ${l.implementationPaid ? "text-emerald-600" : "text-amber-600"}`}>
                          {l.implementationPaid ? "pago" : "em aberto"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {brl(l.monthlyFee)}
                        {l.cycle !== "MENSAL" && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            ({brl(l.valorCobranca)}/{l.cycle === "ANUAL" ? "ano" : "sem."})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                        {brl(l.jaGerou)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tomSituacao[l.situacao]}`}>
                          {situacaoLabel[l.situacao]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-100 bg-slate-50/40 font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td />
                    <td className="px-4 py-3 text-right tabular-nums">
                      {brl(lojas.reduce((s, l) => s + l.implementationFee, 0))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(resumo.mrr)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {brl(lojas.reduce((s, l) => s + l.jaGerou, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <p className="text-xs text-slate-400">
            Os valores de implantação e recorrência são editados no painel <b>Lojas</b> (cartão de
            cobrança de cada uma). Aqui é a visão consolidada.
          </p>
        </div>
      )}

      {/* ---------------- LEADS ---------------- */}
      {aba === "leads" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(canalLeadLabel) as CanalDeLead[]).map((canal) => {
              const c = canais[canal];
              return (
                <Card key={canal} className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {canalLeadLabel[canal]}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{c.mes}</p>
                  <p className="text-[11px] text-slate-400">no mês · {c.dias30} em 30 dias</p>
                  <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                    <b className="tabular-nums text-slate-700">{c.total}</b> no total
                  </p>
                </Card>
              );
            })}
          </div>

          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">De onde vêm os leads (no mês)</p>
            {(() => {
              const linhas = (Object.keys(canalLeadLabel) as CanalDeLead[])
                .map((c) => ({ canal: c, valor: canais[c].mes }))
                .sort((a, b) => b.valor - a.valor);
              const maior = Math.max(...linhas.map((l) => l.valor), 1);
              const total = linhas.reduce((s, l) => s + l.valor, 0);
              if (total === 0)
                return <p className="py-6 text-center text-sm text-slate-400">Nenhum lead novo neste mês.</p>;
              return (
                <div className="space-y-2">
                  {linhas.map((l) => (
                    <div key={l.canal} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 truncate text-sm text-slate-700">
                        {canalLeadLabel[l.canal]}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${Math.round((l.valor / maior) * 100)}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-800">
                        {l.valor}
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-400">
                        {total ? Math.round((l.valor / total) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-snug text-slate-400">
              <b>Site/landing</b> e <b>link da bio</b> são leads da AtacadoPro (quem quer contratar o
              sistema). <b>Catálogos das lojas</b> são os clientes finais que as lojas captaram — é o
              termômetro de quanto o produto está sendo usado de verdade.
            </p>
          </Card>
        </div>
      )}

      {/* ---------------- SISTEMA ---------------- */}
      {aba === "sistema" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Intercorrências" valor={String(intercorrencias.length)} hint="últimas registradas" />
            <Kpi
              label="WhatsApp conectado"
              valor={`${lojas.filter((l) => l.whatsapp === "CONECTADO").length}/${lojas.length}`}
              hint="lojas com o número no ar"
            />
            <Kpi label="Lojas suspensas" valor={String(resumo.lojasSuspensas)} hint="acesso bloqueado" />
            <Kpi label="Em risco" valor={String(resumo.emRisco)} hint="sem uso há 14+ dias" />
          </div>

          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">Conexão de WhatsApp por loja</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {lojas.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span className="truncate text-sm text-slate-700">{l.nome}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      l.whatsapp === "CONECTADO"
                        ? "bg-emerald-50 text-emerald-700"
                        : l.whatsapp === "AGUARDANDO_QR"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {l.whatsapp === "CONECTADO"
                      ? "conectado"
                      : l.whatsapp === "AGUARDANDO_QR"
                        ? "aguardando QR"
                        : "desconectado"}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <AlertTriangle className="size-4 text-amber-500" />
              <p className="text-sm font-semibold text-slate-800">Intercorrências do sistema</p>
            </div>
            {intercorrencias.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Nenhuma intercorrência registrada. Sistema limpo. ✅
              </p>
            ) : (
              <div className="divide-y divide-slate-50">
                {intercorrencias.map((e) => (
                  <div key={e.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          e.origem === "superadmin"
                            ? "bg-violet-100 text-violet-700"
                            : e.origem === "watchdog"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {e.origem}
                      </span>
                      {e.caminho && (
                        <span className="font-mono text-[11px] text-slate-400">{e.caminho}</span>
                      )}
                      <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                        <Clock className="size-3" />
                        {dateShort(e.quando)} {timeShort(e.quando)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{e.mensagem}</p>
                    {e.detalhe && (
                      <p className="mt-0.5 line-clamp-2 font-mono text-[11px] text-slate-400">{e.detalhe}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---------------- EXCLUIR LOJA (dupla confirmação) ---------------- */}
      {excluindo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-pop">
            <p className="flex items-center gap-2 text-lg font-bold text-rose-700">
              <AlertTriangle className="size-5" />
              Excluir {excluindo.nome}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Isso apaga <b>tudo</b> desta loja e <b>não tem como desfazer</b>:
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 sm:grid-cols-4">
              <div>
                <p className="text-lg font-bold tabular-nums">{excluindo.clientes}</p>
                <p className="text-[11px]">clientes</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums">{excluindo.pedidosGeradosMes}+</p>
                <p className="text-[11px]">pedidos</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums">{excluindo.produtos}</p>
                <p className="text-[11px]">produtos</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums">{excluindo.usuarios}</p>
                <p className="text-[11px]">usuários</p>
              </div>
            </div>
            {excluindo.jaGerou > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠️ Esta loja já pagou <b>{brl(excluindo.jaGerou)}</b> para a plataforma. O histórico
                financeiro dela também será apagado.
              </p>
            )}
            <p className="mt-3 text-sm text-slate-600">
              Para confirmar, digite o nome exato da loja:
            </p>
            <p className="mb-1 font-mono text-sm font-bold text-slate-800">{excluindo.nome}</p>
            <input
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              placeholder="Digite o nome da loja"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-rose-400"
            />
            {erroExcluir && <p className="mt-2 text-sm text-rose-600">{erroExcluir}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setExcluindo(null);
                  setConfirmacao("");
                  setErroExcluir("");
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={excluirLoja}
                disabled={ocupado || confirmacao.trim().toLowerCase() !== excluindo.nome.trim().toLowerCase()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-40"
              >
                {ocupado ? "Excluindo…" : "Excluir definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
