"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Input, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { brl } from "@/lib/format";
import {
  DRE_LABEL,
  rotuloDoMes,
  type RelatorioDRE,
} from "@/lib/financeiro/relatorios-tipos";

/**
 * DRE (RN-034) — "a loja deu lucro?". Por COMPETÊNCIA: a venda de agosto é
 * resultado de agosto, mesmo que a cliente pague em outubro.
 */
export function DreView({
  filtro,
  dre,
}: {
  filtro: { de: string; ate: string };
  dre: RelatorioDRE;
}) {
  const router = useRouter();
  const pct = (v: number) =>
    dre.totais.receita > 0 ? `${Math.round((v / dre.totais.receita) * 100)}%` : "—";

  function aplicar(mudanca: Partial<typeof filtro>) {
    const novo = { ...filtro, ...mudanca };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(novo)) if (v) p.set(k, v);
    router.push(`?${p.toString()}`);
  }

  const colunas = dre.meses.length;
  const Linha = ({
    rotulo,
    valores,
    total,
    destaque,
    tom,
  }: {
    rotulo: string;
    valores: number[];
    total: number;
    destaque?: boolean;
    tom?: "bom" | "ruim";
  }) => (
    <tr
      className={
        destaque
          ? "border-t border-slate-200 bg-slate-50 font-semibold text-slate-900"
          : "hover:bg-slate-50/70"
      }
    >
      <td className="sticky left-0 z-10 bg-inherit px-4 py-2.5 text-slate-700">
        {rotulo}
      </td>
      {valores.map((v, i) => (
        <td
          key={i}
          className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${
            tom === "ruim" && v < 0 ? "text-rose-700" : ""
          } ${tom === "bom" && v > 0 ? "text-emerald-700" : ""}`}
        >
          {v === 0 ? "—" : brl(v)}
        </td>
      ))}
      <td className="whitespace-nowrap border-l border-slate-100 px-4 py-2.5 text-right font-semibold tabular-nums">
        {brl(total)}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-slate-400 tabular-nums">
        {pct(total)}
      </td>
    </tr>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="A loja deu lucro?"
        subtitle="O resultado por mês, contando cada venda e cada despesa no mês em que aconteceram (DRE)."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/financeiro/fluxo-de-caixa"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Fluxo de caixa
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

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Receitas" value={brl(dre.totais.receita)} tone="good" />
        <StatTile
          label="Lucro bruto"
          value={brl(dre.totais.lucroBruto)}
          hint={`${pct(dre.totais.lucroBruto)} da receita`}
          tone={dre.totais.lucroBruto >= 0 ? "good" : "bad"}
        />
        <StatTile label="Despesas" value={brl(dre.totais.despesas)} />
        <StatTile
          label="Resultado"
          value={brl(dre.totais.resultado)}
          hint={`${pct(dre.totais.resultado)} da receita`}
          tone={dre.totais.resultado >= 0 ? "good" : "bad"}
        />
      </div>

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
          <p className="ml-auto max-w-lg text-xs text-slate-400">
            Aqui vale a data do fato, não a do pagamento: a venda de agosto é
            resultado de agosto mesmo que a cliente pague em outubro. Para saber
            quando o dinheiro entra, veja o <b>fluxo de caixa</b>.
          </p>
        </div>
      </Card>

      {dre.truncado && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800">
          ⚠️ Este período tem lançamentos demais para caber num relatório só —
          alguns ficaram de fora. Escolha menos meses para o resultado sair
          completo.
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left">
                  Conta
                </th>
                {dre.meses.map((m) => (
                  <th key={m} className="whitespace-nowrap px-4 py-3 text-right">
                    {rotuloDoMes(m)}
                  </th>
                ))}
                <th className="border-l border-slate-200 px-4 py-3 text-right">
                  Total
                </th>
                <th className="px-4 py-3 text-right">% receita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {dre.blocos.map((b) => (
                <Fragment key={b.bloco}>
                  <Linha
                    rotulo={DRE_LABEL[b.bloco]}
                    valores={b.meses}
                    total={b.total}
                    destaque
                  />
                  {b.linhas.map((l) => (
                    <tr key={`${b.bloco}-${l.chave}`} className="hover:bg-slate-50/70">
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
                      <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-slate-400 tabular-nums">
                        {pct(l.total)}
                      </td>
                    </tr>
                  ))}
                  {b.bloco === "CUSTO" && (
                    <Linha
                      rotulo="= Lucro bruto"
                      valores={dre.lucroBruto}
                      total={dre.totais.lucroBruto}
                      destaque
                      tom="bom"
                    />
                  )}
                </Fragment>
              ))}
              <Linha
                rotulo="= Resultado do período"
                valores={dre.resultado}
                total={dre.totais.resultado}
                destaque
                tom="ruim"
              />
            </tbody>
          </table>
        </div>
      </Card>

      {dre.totais.investimento !== 0 && (
        <p className="mt-3 rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-500">
          💡 <b>{brl(dre.totais.investimento)}</b> em investimentos (máquina,
          reforma, móveis) ficaram <b>fora</b> deste resultado de propósito:
          comprar uma máquina não é prejuízo, é dinheiro que virou máquina. O
          efeito no caixa aparece no{" "}
          <Link href="/financeiro/dfc" className="text-brand-700 hover:underline">
            &quot;por onde o dinheiro andou&quot;
          </Link>
          .
        </p>
      )}
    </div>
  );
}
