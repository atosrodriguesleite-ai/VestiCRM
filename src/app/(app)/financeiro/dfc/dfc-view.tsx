"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Input, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { brl } from "@/lib/format";
import { DFC_LABEL, type RelatorioDFC } from "@/lib/financeiro/dfc-tipos";

/**
 * DFC (RN-035). O teste de honestidade do relatório está na tela: saldo
 * inicial + o que a loja gerou = saldo final. Se sobrar diferença, ela é
 * DITA (transferência entrando ou saindo do recorte), nunca escondida.
 */
export function DfcView({
  filtro,
  dfc,
}: {
  filtro: { de: string; ate: string };
  dfc: RelatorioDFC;
}) {
  const router = useRouter();

  function aplicar(mudanca: Partial<typeof filtro>) {
    const novo = { ...filtro, ...mudanca };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(novo)) if (v) p.set(k, v);
    router.push(`?${p.toString()}`);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Por onde o dinheiro andou"
        subtitle="O que entrou e saiu de verdade no período, separado por tipo de movimento (DFC)."
        action={
          <Link
            href="/financeiro"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Financeiro
          </Link>
        }
      />

      {dfc.truncado && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          O período tem mais movimento do que cabe numa consulta só — os
          números abaixo somam parte dele. Encurte as datas para a conta
          fechar.
        </p>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Saldo no início" value={brl(dfc.saldoInicial)} />
        <StatTile
          label="A loja gerou"
          value={brl(dfc.geradoNoPeriodo)}
          tone={dfc.geradoNoPeriodo >= 0 ? "good" : "bad"}
          hint="entradas − saídas do período"
        />
        <StatTile
          label="Transferências"
          value={brl(dfc.transferencias)}
          hint="entre contas da loja (não é resultado)"
        />
        {/* só aparece quando existe: conta cadastrada com saldo dentro do
            período traz dinheiro que a loja não gerou — sem esta linha ele
            seria chamado de "transferência", que é o nome errado */}
        {dfc.saldosDeclarados !== 0 && (
          <StatTile
            label="Contas cadastradas"
            value={brl(dfc.saldosDeclarados)}
            hint="saldo que já existia na conta cadastrada no período"
          />
        )}
        <StatTile
          label="Saldo no fim"
          value={brl(dfc.saldoFinal)}
          tone={dfc.saldoFinal < 0 ? "bad" : "default"}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            De
            <Input
              type="date"
              className="mt-1 !py-2"
              value={filtro.de}
              onChange={(e) => aplicar({ de: e.target.value })}
            />
          </label>
          <label className="text-xs text-slate-500">
            Até
            <Input
              type="date"
              className="mt-1 !py-2"
              value={filtro.ate}
              onChange={(e) => aplicar({ ate: e.target.value })}
            />
          </label>
          <p className="ml-auto max-w-md text-xs text-slate-400">
            A conta fecha: saldo no início + o que a loja gerou
            {dfc.saldosDeclarados !== 0 ? " + o saldo das contas cadastradas" : ""}
            {dfc.transferencias !== 0 ? " + transferências" : ""} = saldo no fim.
          </p>
        </div>
      </Card>

      <div className="space-y-4">
        {dfc.grupos.map((g) => (
          <Card key={g.grupo} className="overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-800">
                {DFC_LABEL[g.grupo]}
              </h2>
              <span
                className={`tabular-nums font-semibold ${
                  g.resultado >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {g.resultado >= 0 ? "+" : "−"}
                {brl(Math.abs(g.resultado))}
              </span>
            </div>
            {g.linhas.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400">
                Nada neste bloco no período.
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {g.linhas.map((l) => (
                    <tr key={l.categoria} className="hover:bg-slate-50/70">
                      <td className="px-5 py-2.5 text-slate-700">{l.categoria}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums text-emerald-700">
                        {l.entrou > 0 ? `+${brl(l.entrou)}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums text-rose-700">
                        {l.saiu > 0 ? `−${brl(l.saiu)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
