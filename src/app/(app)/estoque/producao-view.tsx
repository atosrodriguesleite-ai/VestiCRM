"use client";

/**
 * ABA PRODUÇÃO DO ESTOQUE (RN-052, Fase 4): só leitura. O que está cortado
 * esperando costura (com o atalho para a tela que LANÇA no estoque), o que
 * está na facção e quanto tecido ainda dá para cortar.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Layers, Scissors, Shirt } from "lucide-react";
import { Alert, Spinner } from "@/components/ui";
import { brl } from "@/lib/format";
import type { ResumoDaProducao } from "@/lib/estoque/producao";

export function ProducaoView() {
  const [dados, setDados] = useState<ResumoDaProducao | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/estoque/producao", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !d) setErro(d?.error ?? "Não foi possível carregar a produção.");
        else setDados(d);
      })
      .catch(() => vivo && setErro("Não foi possível carregar a produção."));
    return () => {
      vivo = false;
    };
  }, []);

  if (erro)
    return (
      <Alert tone="danger" icon={<AlertTriangle />}>
        {erro}
      </Alert>
    );
  if (!dados)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Numero rotulo="Cortadas, esperando costura" valor={dados.cortadas.aguardando.toLocaleString("pt-BR")} hint="ainda não viraram produto" tom="amber" />
        <Numero
          rotulo="Em lote de costura"
          valor={dados.faccao.fora.toLocaleString("pt-BR")}
          hint={`${dados.faccao.naFaccao} na facção · ${dados.faccao.fora - dados.faccao.naFaccao} na costura interna · ${dados.faccao.lotesAbertos} lote(s) aberto(s)`}
        />
        <Numero rotulo="Tecido para cortar" valor={`${dados.rolos.kg.toFixed(1)} kg`} hint={`${dados.rolos.quantidade} rolo(s) com sobra`} />
        <Numero rotulo="Valor em tecido" valor={brl(dados.rolos.valor)} hint="pelo preço pago por kg" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
            <Shirt className="size-4 text-amber-600 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Cortado, esperando costura</p>
              <p className="text-[11px] text-slate-400">Cortado e ainda não lançado como produto (nem em lote de costura). Quando a peça fica pronta, lance na tela Costura — o estoque sobe por lá.</p>
            </div>
            <Link href="/producao/costura" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline whitespace-nowrap">
              lançar <ArrowRight className="size-3" />
            </Link>
          </div>
          {dados.cortadas.itens.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400 text-center">Nada cortado esperando. Tudo já virou produto.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Modelo</th>
                  <th className="text-left px-3 py-2 font-medium">Corte</th>
                  <th className="text-right px-3 py-2 font-medium">Peças</th>
                </tr>
              </thead>
              <tbody>
                {dados.cortadas.itens.map((i, k) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="text-slate-800 leading-tight">{i.productName}</div>
                      <div className="text-[11px] text-slate-400">{[i.color, i.size].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{i.cutCode ? `#${String(i.cutCode).padStart(6, "0")}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{i.pendentes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
            <Layers className="size-4 text-sky-600 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">Tecido disponível para corte</p>
              <p className="text-[11px] text-slate-400">Rolos de tecido ativo com sobra, por tecido e cor (a mesma lista da tela Cortes).</p>
            </div>
            <Link href="/producao/cortes" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline whitespace-nowrap">
              <Scissors className="size-3" /> cortar
            </Link>
          </div>
          {dados.rolos.porTecido.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400 text-center">Nenhum rolo com sobra cadastrado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Tecido</th>
                  <th className="text-right px-3 py-2 font-medium">Rolos</th>
                  <th className="text-right px-3 py-2 font-medium">Kg</th>
                  <th className="text-right px-3 py-2 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {dados.rolos.porTecido.map((t, k) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="text-slate-800 leading-tight">{t.tecido}</div>
                      <div className="text-[11px] text-slate-400">{t.cor}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.rolos}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.kg.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(t.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, hint, tom }: { rotulo: string; valor: string; hint?: string; tom?: "amber" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${tom === "amber" ? "text-amber-700" : "text-slate-900"}`}>{valor}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
