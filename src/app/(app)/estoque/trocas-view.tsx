"use client";

/**
 * RELATÓRIO DE TROCAS (RN-073) — qual peça volta, por quê, e quanto isso
 * mexeu em dinheiro, no período escolhido. A conta mora em
 * `lib/troca/relatorio.ts`; aqui é só leitura.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, PackageX, Tag } from "lucide-react";
import { Alert, Spinner } from "@/components/ui";
import { brl, dateShort } from "@/lib/format";
import { orderNumber } from "@/lib/orders";
import type { RelatorioDeTrocas } from "@/lib/troca/relatorio";

const PERIODOS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 365, rotulo: "1 ano" },
];

export function TrocasView() {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<RelatorioDeTrocas | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro("");
    fetch(`/api/estoque/trocas?dias=${dias}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !d) setErro(d?.error ?? "Não foi possível carregar as trocas.");
        else setDados(d);
      })
      .catch(() => vivo && setErro("Não foi possível carregar as trocas."));
    return () => {
      vivo = false;
    };
  }, [dias]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            onClick={() => setDias(p.dias)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
              dias === p.dias ? "bg-brand-600 border-brand-600 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {erro ? (
        <Alert tone="danger" icon={<AlertTriangle />}>
          {erro}
        </Alert>
      ) : !dados ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner />
        </div>
      ) : dados.totais.trocas === 0 ? (
        <div className="text-center py-14 text-slate-400">
          <ArrowLeftRight className="size-8 mx-auto mb-2" />
          <p className="text-sm">Nenhuma troca registrada neste período.</p>
          <p className="text-xs mt-1">A troca se registra na ficha do pedido entregue, no bloco “Trocas”.</p>
        </div>
      ) : (
        <Conteudo dados={dados} />
      )}
    </div>
  );
}

function Conteudo({ dados }: { dados: RelatorioDeTrocas }) {
  const t = dados.totais;
  const maxMotivo = Math.max(1, ...dados.motivos.map((m) => m.trocas));
  return (
    <>
      {dados.truncado && (
        <Alert tone="warning" icon={<AlertTriangle />}>
          Período com muitas trocas: a conta usa as {t.trocas.toLocaleString("pt-BR")} mais recentes. Escolha um período menor para ver tudo.
        </Alert>
      )}
      {t.deCancelados > 0 && (
        <p className="text-xs text-slate-500">
          {t.deCancelados === 1 ? "1 troca é" : `${t.deCancelados} trocas são`} de pedido depois cancelado: as peças
          contam, mas o dinheiro dela foi desfeito com a venda e fica fora dos valores abaixo.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Numero rotulo="Trocas" valor={String(t.trocas)} />
        <Numero rotulo="Peças que voltaram" valor={String(t.pecasVoltaram)} hint={t.pecasDefeito ? `${t.pecasDefeito} com defeito` : "nenhuma com defeito"} tom={t.pecasDefeito ? "rose" : undefined} />
        <Numero rotulo="Peças que saíram" valor={String(t.pecasSairam)} hint="levadas no lugar" />
        <Numero rotulo="Diferença recebida" valor={brl(t.recebido)} hint={t.aReceber > 0 ? `${brl(t.aReceber)} a confirmar` : "peça nova mais cara"} tom="emerald" />
        <Numero rotulo="Devolvido" valor={brl(t.devolvido)} hint={t.aDevolver > 0 ? `${brl(t.aDevolver)} a confirmar` : "em dinheiro"} tom={t.devolvido || t.aDevolver ? "amber" : undefined} />
        <Numero rotulo="Crédito dado" valor={brl(t.creditoDado)} hint="na ficha das clientes" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Tag className="size-4 text-brand-600" /> Por que trocaram
          </h3>
          <ul className="mt-3 space-y-2">
            {dados.motivos.map((m) => (
              <li key={m.motivo}>
                <div className="flex justify-between text-sm">
                  <span>{m.motivo}</span>
                  <span className="tabular-nums text-slate-500">
                    {m.trocas} · {m.pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(m.trocas / maxMotivo) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2 min-w-0">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <PackageX className="size-4 text-brand-600" /> Peças que mais voltam
          </h3>
          <p className="text-[11px] text-slate-400">
            Por modelo, cor e tamanho — onde olhar a grade, a modelagem ou o acabamento.
            {dados.pecasDistintas > dados.pecas.length && ` Mostrando as ${dados.pecas.length} que mais voltam de ${dados.pecasDistintas}.`}
          </p>
          <div className="mt-2 overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">Peça</th>
                  <th className="py-1.5 px-2 font-medium text-right">Voltaram</th>
                  <th className="py-1.5 px-2 font-medium text-right">Defeito</th>
                  <th className="py-1.5 pl-2 font-medium text-right">Trocas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dados.pecas.map((p) => (
                  <tr key={p.chave}>
                    <td className="py-1.5 pr-2 min-w-0">
                      <span className="block truncate max-w-[16rem]">{p.nome}</span>
                      <span className="text-[11px] text-slate-400">{[p.cor, p.tamanho].filter(Boolean).join(" · ") || "—"}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-medium">{p.voltaram}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${p.defeito ? "text-rose-600 font-medium" : "text-slate-400"}`}>{p.defeito || "—"}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-slate-500">{p.trocas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <ArrowLeftRight className="size-4 text-brand-600" /> Últimas trocas
        </h3>
        <ul className="mt-2 divide-y divide-slate-100">
          {dados.ultimas.map((u) => (
            <li key={u.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">
                  <Link href={`/pedidos/${u.pedidoId}`} className="text-brand-700 hover:underline">
                    {orderNumber(u.pedido)}
                  </Link>{" "}
                  · troca {u.numero} · {u.cliente}
                  {u.pedidoCancelado && <span className="ml-1 text-[11px] text-rose-600">· pedido cancelado</span>}
                </span>
                <span className="text-[11px] text-slate-400">
                  {dateShort(new Date(u.quando))} · {u.por}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                <span className="text-slate-400">Voltou:</span> {u.voltou} <span className="text-slate-400">· Levou:</span> {u.levou}
              </p>
              <p className="text-xs mt-0.5">
                {u.pedidoCancelado ? (
                  <span className="text-slate-400">Dinheiro desfeito com o cancelamento do pedido</span>
                ) : Math.abs(u.diferenca) < 0.005 ? (
                  <span className="text-slate-400">Sem diferença</span>
                ) : u.resolucao === "COBRAR" ? (
                  <span className="text-emerald-700">Cliente pagou {brl(u.diferenca)}{u.acertada ? "" : " · a confirmar"}</span>
                ) : u.resolucao === "CREDITO" ? (
                  <span className="text-slate-600">Crédito de {brl(-u.diferenca)} na ficha</span>
                ) : (
                  <span className="text-amber-700">Loja devolveu {brl(-u.diferenca)}{u.acertada ? "" : " · a confirmar"}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Numero({ rotulo, valor, hint, tom }: { rotulo: string; valor: string; hint?: string; tom?: "emerald" | "amber" | "rose" }) {
  const cor =
    tom === "emerald" ? "text-emerald-700" : tom === "amber" ? "text-amber-700" : tom === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${cor}`}>{valor}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
