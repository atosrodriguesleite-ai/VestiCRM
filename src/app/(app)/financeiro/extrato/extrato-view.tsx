"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, Wallet } from "lucide-react";
import { Card, Input, PageHeader, inputCls } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { brl } from "@/lib/format";
import type { CardsExtrato, LinhaExtrato } from "@/lib/financeiro/extrato";
import { formatarDia } from "@/lib/financeiro/dia";

/**
 * EXTRATO (RN-032). A coluna que a lojista realmente lê é a do SALDO: é ela
 * que ela compara, linha a linha, com o extrato do banco.
 */
export function ExtratoView({
  filtro,
  contas,
  linhas,
  cards,
  truncado,
}: {
  filtro: { de: string; ate: string; conta: string };
  contas: { id: string; nome: string; cor: string; arquivada: boolean }[];
  linhas: LinhaExtrato[];
  cards: CardsExtrato;
  truncado: boolean;
}) {
  const router = useRouter();

  function aplicar(mudanca: Partial<typeof filtro>) {
    const novo = { ...filtro, ...mudanca };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(novo)) if (v) p.set(k, v);
    router.push(`?${p.toString()}`);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Extrato"
        subtitle="Tudo que entrou, saiu e foi transferido — com o saldo acumulado, para conferir com o banco."
        action={
          <div className="flex gap-2">
            <Link
              href="/financeiro/transferencias"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeftRight className="size-4" /> Transferências
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

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile label="Saldo no início" value={brl(cards.saldoInicial)} icon={<Wallet />} />
        <StatTile
          label="Entrou no período"
          value={brl(cards.receitasRealizadas)}
          icon={<ArrowDownCircle />}
          tone="good"
        />
        <StatTile
          label="Saiu no período"
          value={brl(cards.despesasRealizadas)}
          icon={<ArrowUpCircle />}
          tone={cards.despesasRealizadas > 0 ? "warn" : "default"}
        />
        <StatTile
          label="Ainda a receber"
          value={brl(cards.receitasEmAberto)}
          hint="vence neste período"
        />
        <StatTile
          label="Ainda a pagar"
          value={brl(cards.despesasEmAberto)}
          hint="vence neste período"
          tone={cards.despesasEmAberto > 0 ? "warn" : "default"}
        />
        <StatTile
          label="Saldo no fim"
          value={brl(cards.saldoFinal)}
          icon={<Wallet />}
          tone={cards.saldoFinal < 0 ? "bad" : "good"}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Conta
            <select
              className={`${inputCls} mt-1 !py-2`}
              value={filtro.conta}
              onChange={(e) => aplicar({ conta: e.target.value })}
            >
              <option value="">Todas as contas</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.arquivada ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          </label>
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
          <p className="ml-auto text-xs text-slate-400">
            Transferência entre contas suas não é receita nem despesa — ela
            aparece aqui, mas fica fora dos cards de entrou/saiu.
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">Cliente/Fornecedor</th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 font-medium">Conta</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60">
                <td className="px-4 py-2 text-xs text-slate-500" colSpan={6}>
                  Saldo em {formatarDia(filtro.de)} (antes do período)
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-600">
                  {brl(cards.saldoInicial)}
                </td>
              </tr>
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    Nenhum movimento neste período.
                  </td>
                </tr>
              )}
              {linhas.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {formatarDia(l.data)}
                  </td>
                  <td className="px-4 py-3">
                    {l.lancamentoId ? (
                      <Link
                        href={`/financeiro/lancamentos/${l.lancamentoId}`}
                        className="font-medium text-slate-800 hover:text-brand-700 hover:underline"
                      >
                        {l.descricao}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-700">
                        <ArrowLeftRight className="size-3.5 text-slate-400" />
                        {l.descricao}
                      </span>
                    )}
                    {l.documento && (
                      <span className="block text-[11px] text-slate-400">
                        doc. {l.documento}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.pessoa ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {l.categoria ?? (l.tipo === "TRANSFERENCIA" ? "transferência" : "—")}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.conta}</td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium ${
                      l.valor >= 0 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {l.valor >= 0 ? "+" : "−"}
                    {brl(Math.abs(l.valor))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                    {brl(l.saldo)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncado && (
          <p className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Período grande: mostrando os primeiros 1.000 movimentos. Encurte as
            datas para ver o resto.
          </p>
        )}
      </Card>
    </div>
  );
}
