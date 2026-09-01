"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { brl } from "@/lib/format";
import { formatarDia } from "@/lib/financeiro/dia";
import { rotuloDoMes } from "@/lib/financeiro/relatorios-tipos";
import { STATUS_LABEL } from "@/lib/financeiro/lancamentos";
import type { CartaoComFaturas } from "@/lib/financeiro/cartao";

/**
 * CARTÕES (RN-039). A conta do cartão não guarda dinheiro: junta as compras
 * numa fatura. Pagar a fatura dá baixa em todas de uma vez, na conta de onde
 * o dinheiro sai de verdade.
 */
export function CartoesView({
  cartoes,
  contas,
  hoje,
}: {
  cartoes: CartaoComFaturas[];
  contas: { id: string; nome: string }[];
  hoje: string;
}) {
  const router = useRouter();
  const [pagando, setPagando] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [conta, setConta] = useState(contas[0]?.id ?? "");
  const [data, setData] = useState(hoje);

  async function pagar(cartaoId: string, mes: string) {
    if (!conta) {
      setErro("Cadastre uma conta de banco para pagar a fatura");
      return;
    }
    setPagando(`${cartaoId}:${mes}`);
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/financeiro/cartoes/${cartaoId}/fatura`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, contaId: conta, data }),
      });
      const d = await res.json().catch(() => null);
      setPagando(null);
      if (!res.ok) {
        setErro(d?.error ?? "Não deu certo — tente de novo");
        return;
      }
      setAviso(`Fatura paga: ${d.parcelas} compra(s), ${brl(d.valor)} 👍`);
      router.refresh();
    } catch {
      setPagando(null);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Cartões de crédito"
        subtitle="As compras juntadas na fatura certa — e a fatura paga de uma vez só."
        action={
          <Link
            href="/financeiro"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Financeiro
          </Link>
        }
      />

      {erro && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {aviso}
        </p>
      )}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Pagar a fatura pela conta
            <select
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={conta}
              onChange={(e) => setConta(e.target.value)}
            >
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            No dia
            <Input
              type="date"
              className="mt-1 !py-2"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </label>
          <p className="ml-auto max-w-md text-xs text-slate-400">
            A compra no cartão é despesa do dia em que você comprou, mas o
            dinheiro só sai da conta quando a fatura é paga — é assim que o
            extrato continua batendo com o banco.
          </p>
        </div>
      </Card>

      <div className="space-y-5">
        {cartoes.map((c) => (
          <Card key={c.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <CreditCard className="size-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">{c.nome}</h2>
              {c.diaFechamento && c.diaVencimento ? (
                <span className="text-xs text-slate-400">
                  fecha dia {c.diaFechamento}, vence dia {c.diaVencimento}
                </span>
              ) : (
                <span className="text-xs text-amber-700">
                  sem os dias da fatura — cadastre em Cadastros
                </span>
              )}
              {c.contaPagamento && (
                <span className="ml-auto text-xs text-slate-400">
                  paga por {c.contaPagamento.nome}
                </span>
              )}
            </div>

            {c.faturas.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">
                Nenhuma compra neste cartão ainda. Lance a despesa escolhendo
                este cartão como conta e ela cai na fatura certa.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {c.faturas.map((f) => (
                  <div key={f.mes} className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap items-baseline gap-2">
                      <h3 className="font-semibold text-slate-800">
                        Fatura de {rotuloDoMes(f.mes)}
                      </h3>
                      <span className="text-xs text-slate-400">
                        vence {formatarDia(f.vencimento)}
                      </span>
                      <span className="ml-auto tabular-nums font-semibold">
                        {brl(f.total)}
                      </span>
                      {f.paga ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          paga
                        </span>
                      ) : (
                        <Button
                          onClick={() => pagar(c.id, f.mes)}
                          disabled={pagando === `${c.id}:${f.mes}`}
                          className="!py-1.5 text-xs"
                        >
                          {pagando === `${c.id}:${f.mes}`
                            ? "Pagando…"
                            : `Pagar ${brl(f.emAberto)}`}
                        </Button>
                      )}
                    </div>
                    <ul className="divide-y divide-slate-50 text-sm">
                      {f.compras.map((compra) => (
                        <li
                          key={compra.parcelaId}
                          className="flex flex-wrap items-center gap-2 py-1.5"
                        >
                          <Link
                            href={`/financeiro/lancamentos/${compra.lancamentoId}`}
                            className="min-w-0 flex-1 truncate text-slate-700 hover:text-brand-700 hover:underline"
                          >
                            {compra.descricao}
                            {compra.totalParcelas > 1 && (
                              <span className="text-slate-400">
                                {" "}
                                ({compra.numero}/{compra.totalParcelas})
                              </span>
                            )}
                          </Link>
                          {compra.fornecedor && (
                            <span className="text-xs text-slate-400">
                              {compra.fornecedor}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400">
                            {STATUS_LABEL[compra.status]}
                          </span>
                          <span className="tabular-nums text-slate-700">
                            {brl(compra.valor)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
