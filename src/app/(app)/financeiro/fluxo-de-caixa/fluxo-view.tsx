"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Input, PageHeader } from "@/components/ui";
import { brl } from "@/lib/format";
import {
  AGRUPAMENTO_LABEL,
  MODO_FLUXO_LABEL,
  rotuloDoMes,
  type AgrupamentoFluxo,
  type LinhaRelatorio,
  type ModoFluxo,
  type RelatorioFluxo,
} from "@/lib/financeiro/relatorios-tipos";

/**
 * FLUXO DE CAIXA (RN-034) — "tem dinheiro?". Mês a mês, com o que já entrou
 * e saiu no passado e o que está previsto daqui para frente.
 */
export function FluxoView({
  filtro,
  fluxo,
}: {
  filtro: { de: string; ate: string; por: AgrupamentoFluxo; modo: ModoFluxo };
  fluxo: RelatorioFluxo;
}) {
  const router = useRouter();

  function aplicar(mudanca: Partial<typeof filtro>) {
    const novo = { ...filtro, ...mudanca };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(novo)) if (v) p.set(k, String(v));
    router.push(`?${p.toString()}`);
  }

  const Grupo = ({
    titulo,
    linhas,
    somas,
    tom,
  }: {
    titulo: string;
    linhas: LinhaRelatorio[];
    somas: number[];
    tom: "entrada" | "saida";
  }) => (
    <>
      <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
        <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">{titulo}</td>
        {somas.map((v, i) => (
          <td
            key={i}
            className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${
              tom === "entrada" ? "text-emerald-700" : "text-rose-700"
            }`}
          >
            {v === 0 ? "—" : brl(v)}
          </td>
        ))}
        <td className="whitespace-nowrap border-l border-slate-100 px-4 py-2.5 text-right tabular-nums">
          {brl(somas.reduce((s, v) => s + v, 0))}
        </td>
      </tr>
      {linhas.length === 0 && (
        <tr>
          <td
            className="px-4 py-2 pl-8 text-sm text-slate-400"
            colSpan={fluxo.meses.length + 2}
          >
            Nada neste bloco no período.
          </td>
        </tr>
      )}
      {linhas.map((l) => (
        <tr key={`${titulo}-${l.chave}`} className="hover:bg-slate-50/70">
          <td className="sticky left-0 z-10 bg-white px-4 py-2 pl-8 text-slate-500">
            {l.rotulo}
          </td>
          {l.meses.map((v, i) => (
            <td
              key={i}
              className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600"
            >
              {v === 0 ? "—" : brl(v)}
            </td>
          ))}
          <td className="whitespace-nowrap border-l border-slate-100 px-4 py-2 text-right tabular-nums text-slate-600">
            {brl(l.total)}
          </td>
        </tr>
      ))}
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Fluxo de caixa"
        subtitle="O dinheiro mês a mês: o que já entrou e saiu, e o que está marcado para acontecer."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/financeiro/dre"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              A loja deu lucro?
            </Link>
            <Link
              href="/financeiro"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Financeiro
            </Link>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            De
            <Input
              type="month"
              className="mt-1 !py-2"
              value={filtro.de}
              onChange={(e) => aplicar({ de: e.target.value })}
            />
          </label>
          <label className="text-xs text-slate-500">
            Até
            <Input
              type="month"
              className="mt-1 !py-2"
              value={filtro.ate}
              onChange={(e) => aplicar({ ate: e.target.value })}
            />
          </label>
          <label className="text-xs text-slate-500">
            Agrupar por
            <select
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={filtro.por}
              onChange={(e) =>
                aplicar({ por: e.target.value as AgrupamentoFluxo })
              }
            >
              {Object.entries(AGRUPAMENTO_LABEL).map(([v, rotulo]) => (
                <option key={v} value={v}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            Mostrar
            <select
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={filtro.modo}
              onChange={(e) => aplicar({ modo: e.target.value as ModoFluxo })}
            >
              {Object.entries(MODO_FLUXO_LABEL).map(([v, rotulo]) => (
                <option key={v} value={v}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        {fluxo.mesDeCorte && (
          <p className="mt-3 text-xs text-slate-400">
            Meses passados mostram só o que aconteceu de verdade. De{" "}
            <b>{rotuloDoMes(fluxo.mesDeCorte)}</b> em diante entra também o que
            está previsto — e o que está <b>atrasado</b> aparece neste mês, que
            é quando a loja vai correr atrás.
          </p>
        )}
        {fluxo.truncado && (
          <p className="mt-2 text-xs text-amber-700">
            {fluxo.motivoDoCorte === "atrasado"
              ? "⚠️ Há contas atrasadas demais para caberem todas neste relatório — o que está em aberto há mais tempo pode ter ficado de fora. A lista completa está em Inadimplência."
              : "⚠️ Período grande demais: escolha menos meses para o relatório sair completo."}
          </p>
        )}
        {!fluxo.mostraSaldo && (
          <p className="mt-2 text-xs text-slate-400">
            Este recorte mostra só a previsão, então não tem linha de saldo:
            somar previsão em cima do saldo real daria um número que não é nem
            uma coisa nem outra. Escolha outro recorte para ver o saldo.
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left">
                  {AGRUPAMENTO_LABEL[filtro.por]}
                </th>
                {fluxo.meses.map((m) => (
                  <th key={m} className="whitespace-nowrap px-4 py-3 text-right">
                    {rotuloDoMes(m)}
                  </th>
                ))}
                <th className="border-l border-slate-200 px-4 py-3 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {fluxo.mostraSaldo && (
                <tr className="bg-white font-medium text-slate-600">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                    Saldo no início
                  </td>
                  {fluxo.saldoInicial.map((v, i) => (
                    <td
                      key={i}
                      className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums"
                    >
                      {brl(v)}
                    </td>
                  ))}
                  <td className="border-l border-slate-100 px-4 py-2.5" />
                </tr>
              )}

              <Grupo
                titulo="Entradas"
                linhas={fluxo.entradas}
                somas={fluxo.totalEntradas}
                tom="entrada"
              />
              <Grupo
                titulo="Saídas"
                linhas={fluxo.saidas}
                somas={fluxo.totalSaidas}
                tom="saida"
              />

              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">
                  Sobrou no mês
                </td>
                {fluxo.geracao.map((v, i) => (
                  <td
                    key={i}
                    className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${
                      v < 0 ? "text-rose-700" : "text-emerald-700"
                    }`}
                  >
                    {brl(v)}
                  </td>
                ))}
                <td className="whitespace-nowrap border-l border-slate-100 px-4 py-2.5 text-right tabular-nums">
                  {brl(fluxo.geracao.reduce((s, v) => s + v, 0))}
                </td>
              </tr>
              {/* nem receita nem despesa, mas mexem no saldo (RN-030): sem
                  estas linhas o "saldo no fim" não bateria com o extrato */}
              {fluxo.aberturas.some((v) => v !== 0) && (
                <tr className="bg-white text-slate-500">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2">
                    Conta cadastrada com saldo
                  </td>
                  {fluxo.aberturas.map((v, i) => (
                    <td
                      key={i}
                      className="whitespace-nowrap px-4 py-2 text-right tabular-nums"
                    >
                      {v === 0 ? "—" : brl(v)}
                    </td>
                  ))}
                  <td className="border-l border-slate-100 px-4 py-2" />
                </tr>
              )}
              {fluxo.transito.some((v) => v !== 0) && (
                <tr className="bg-white text-slate-500">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2">
                    Transferência entre contas
                  </td>
                  {fluxo.transito.map((v, i) => (
                    <td
                      key={i}
                      className="whitespace-nowrap px-4 py-2 text-right tabular-nums"
                    >
                      {v === 0 ? "—" : brl(v)}
                    </td>
                  ))}
                  <td className="border-l border-slate-100 px-4 py-2" />
                </tr>
              )}
              {fluxo.mostraSaldo && (
                <tr className="bg-white font-semibold text-slate-900">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                    Saldo no fim
                  </td>
                  {fluxo.saldoFinal.map((v, i) => (
                    <td
                      key={i}
                      className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${
                        v < 0 ? "text-rose-700" : ""
                      }`}
                    >
                      {brl(v)}
                    </td>
                  ))}
                  <td className="border-l border-slate-100 px-4 py-2.5" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-slate-400">
        Este é o dinheiro entrando e saindo. Para saber se a loja teve
        <b> lucro</b> — que é outra conta —, veja{" "}
        <Link href="/financeiro/dre" className="text-brand-700 hover:underline">
          a loja deu lucro?
        </Link>
      </p>
    </div>
  );
}
