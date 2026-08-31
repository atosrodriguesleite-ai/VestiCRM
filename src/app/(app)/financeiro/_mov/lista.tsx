"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  CircleDollarSign,
  AlertTriangle,
  CalendarClock,
  Clock,
  CheckCircle2,
  Sigma,
} from "lucide-react";
import { Button, Card, Input, PageHeader, inputCls } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { brl } from "@/lib/format";
import { formatarDia } from "@/lib/financeiro/dia";
import {
  STATUS_LABEL,
  type ResumoPeriodo,
  type StatusParcela,
} from "@/lib/financeiro/lancamentos";
import type { LinhaMovimentacao } from "@/lib/financeiro/consulta";
import { FormLancamento, type Opcao } from "./form-lancamento";
import { BaixaModal } from "./baixa-modal";

/**
 * CONTAS A RECEBER / A PAGAR (RN-028) — a lista de PARCELAS do período.
 *
 * O que a lojista faz aqui em 90% das visitas: olhar o que está atrasado e
 * dar baixa no que caiu. Por isso a baixa é um clique na própria linha, sem
 * abrir a ficha.
 */

export type FiltroTela = {
  de: string;
  ate: string;
  base: string;
  status: string;
  q: string;
};

const CORES: Record<StatusParcela, string> = {
  ATRASADA: "bg-rose-50 text-rose-700 ring-rose-200",
  VENCE_HOJE: "bg-amber-50 text-amber-700 ring-amber-200",
  PENDENTE: "bg-sky-50 text-sky-700 ring-sky-200",
  PARCIAL: "bg-violet-50 text-violet-700 ring-violet-200",
  QUITADA: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CANCELADA: "bg-slate-100 text-slate-500 ring-slate-200",
};

const BASES = [
  { v: "vencimento", label: "Vencimento" },
  { v: "emissao", label: "Emissão" },
  { v: "liquidacao", label: "Liquidação" },
];

export function ListaMovimentacoes({
  tipo,
  hoje,
  filtro,
  linhas,
  resumo,
  truncado,
  contas,
  categorias,
  fornecedores,
  centros,
  colecoes,
}: {
  tipo: "RECEITA" | "DESPESA";
  hoje: string;
  filtro: FiltroTela;
  linhas: LinhaMovimentacao[];
  resumo: ResumoPeriodo;
  truncado: boolean;
  contas: {
    id: string;
    nome: string;
    padrao: boolean;
    tipo?: string;
    diaFechamento?: number | null;
    diaVencimento?: number | null;
  }[];
  categorias: Opcao[];
  fornecedores: { id: string; nome: string; categoriaPadraoId: string | null }[];
  centros: Opcao[];
  colecoes: Opcao[];
}) {
  const router = useRouter();
  const receita = tipo === "RECEITA";
  const [busca, setBusca] = useState(filtro.q);
  const [criando, setCriando] = useState(false);
  const [baixando, setBaixando] = useState<LinhaMovimentacao | null>(null);

  function aplicar(mudanca: Partial<FiltroTela>) {
    const novo = { ...filtro, ...mudanca };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(novo)) if (v) p.set(k, v);
    router.push(`?${p.toString()}`);
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title={receita ? "Contas a Receber" : "Contas a Pagar"}
        subtitle={
          receita
            ? "O que a loja tem para receber: quem deve, quanto e quando vence."
            : "O que a loja tem para pagar: fornecedor, vencimento e quanto falta."
        }
        action={
          <div className="flex gap-2">
            <Link
              href="/financeiro"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Financeiro
            </Link>
            <Button size="md" onClick={() => setCriando(true)}>
              <Plus className="size-4" /> Novo lançamento
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <StatTile
          label="Atrasado"
          value={brl(resumo.atrasado)}
          icon={<AlertTriangle />}
          tone={resumo.atrasado > 0 ? "bad" : "good"}
        />
        <StatTile label="Vence hoje" value={brl(resumo.venceHoje)} icon={<CalendarClock />} tone={resumo.venceHoje > 0 ? "warn" : "default"} />
        <StatTile label="A vencer" value={brl(resumo.pendente)} icon={<Clock />} />
        <StatTile
          label={receita ? "Recebido" : "Pago"}
          value={brl(resumo.quitado)}
          icon={<CheckCircle2 />}
          tone="good"
        />
        <StatTile label="Total do período" value={brl(resumo.total)} icon={<Sigma />} />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Filtrar por
            <select
              className={`${inputCls} mt-1 !py-2`}
              value={filtro.base}
              onChange={(e) => aplicar({ base: e.target.value })}
            >
              {BASES.map((b) => (
                <option key={b.v} value={b.v}>
                  {b.label}
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
          <label className="text-xs text-slate-500">
            Situação
            <select
              className={`${inputCls} mt-1 !py-2`}
              value={filtro.status}
              onChange={(e) => aplicar({ status: e.target.value })}
            >
              <option value="TODOS">Todas</option>
              {(Object.keys(STATUS_LABEL) as StatusParcela[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-52 flex-1 text-xs text-slate-500">
            Buscar
            <span className="relative mt-1 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="!py-2 pl-9"
                placeholder="Descrição, documento, cliente…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aplicar({ q: busca })}
                onBlur={() => busca !== filtro.q && aplicar({ q: busca })}
              />
            </span>
          </label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Vencimento</th>
                <th className="px-4 py-3 font-medium">Liquidação</th>
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium">
                  {receita ? "Cliente" : "Fornecedor"}
                </th>
                <th className="px-4 py-3 font-medium">Categoria</th>
                <th className="px-4 py-3 text-right font-medium">Valor</th>
                <th className="px-4 py-3 text-right font-medium">Falta</th>
                <th className="px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Nada neste período. Mude as datas ou lance a primeira conta.
                  </td>
                </tr>
              )}
              {linhas.map((l) => (
                <tr key={l.parcelaId} className="hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    {formatarDia(l.vencimento)}
                    {l.diasAtraso > 0 && l.status === "ATRASADA" && (
                      <span className="ml-1.5 text-[11px] text-rose-600">
                        {l.diasAtraso}d
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-500">
                    {l.liquidacao ? formatarDia(l.liquidacao) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/financeiro/lancamentos/${l.lancamentoId}`}
                      className="font-medium text-slate-800 hover:text-brand-700 hover:underline"
                    >
                      {l.descricao}
                    </Link>
                    {l.totalParcelas > 1 && (
                      <span className="ml-1.5 text-[11px] text-slate-400">
                        {l.numero}/{l.totalParcelas}
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
                    {l.categoria ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium">
                    {brl(l.valor)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${
                      l.saldo > 0 ? "text-slate-700" : "text-slate-300"
                    }`}
                  >
                    {l.saldo > 0 ? brl(l.saldo) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CORES[l.status]}`}
                    >
                      {STATUS_LABEL[l.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!l.cancelado && l.saldo > 0 && (
                      <button
                        type="button"
                        onClick={() => setBaixando(l)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <CircleDollarSign className="size-3.5" />
                        {receita ? "Recebi" : "Paguei"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncado && (
          <p className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Mostrando as primeiras 500 parcelas do período — encurte as datas
            para ver o resto.
          </p>
        )}
      </Card>

      {criando && (
        <FormLancamento
          tipo={tipo}
          hoje={hoje}
          contas={contas}
          categorias={categorias}
          fornecedores={fornecedores}
          centros={centros}
          colecoes={colecoes}
          onFechar={() => setCriando(false)}
          onSalvo={() => {
            setCriando(false);
            router.refresh();
          }}
        />
      )}

      {baixando && (
        <BaixaModal
          linha={baixando}
          tipo={tipo}
          hoje={hoje}
          contas={contas}
          onFechar={() => setBaixando(null)}
          onSalvo={() => {
            setBaixando(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

