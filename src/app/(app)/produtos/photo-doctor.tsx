"use client";

/**
 * Botão "Verificar fotos": chama o médico de fotos do catálogo. Conserta em
 * lotes (repete a chamada enquanto houver externas pendentes) e mostra o
 * relatório: quantas estão salvas, quantas foram internalizadas agora e quais
 * produtos ficaram com foto irrecuperável (para re-upload).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, X, CheckCircle2, AlertTriangle } from "lucide-react";

type Report = {
  total: number;
  salvasNoBanco: number;
  internas: number;
  consertadasAgora: number;
  consertadasProdutos: string[];
  otimizadasAgora: number;
  otimizadasProdutos: string[];
  corrompidasRemovidas: number;
  corrompidasProdutos: string[];
  falharam: string[];
  invalidas: string[];
  externasRestantes: number;
  pesadasRestantes: number;
};

export function PhotoDoctor() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      let acc: Report | null = null;
      // repete enquanto houver fotos externas pendentes (lotes)
      for (let round = 0; round < 30; round++) {
        const res = await fetch("/api/products/photo-doctor", { method: "POST" });
        if (!res.ok) throw new Error(String(res.status));
        const r: Report = await res.json();
        acc = acc
          ? {
              ...r,
              consertadasAgora: acc.consertadasAgora + r.consertadasAgora,
              consertadasProdutos: [
                ...new Set([...acc.consertadasProdutos, ...r.consertadasProdutos]),
              ],
              otimizadasAgora: acc.otimizadasAgora + r.otimizadasAgora,
              otimizadasProdutos: [
                ...new Set([...acc.otimizadasProdutos, ...r.otimizadasProdutos]),
              ],
              corrompidasRemovidas: acc.corrompidasRemovidas + r.corrompidasRemovidas,
              corrompidasProdutos: [
                ...new Set([...acc.corrompidasProdutos, ...r.corrompidasProdutos]),
              ],
              falharam: [...new Set([...acc.falharam, ...r.falharam])],
            }
          : r;
        if (r.externasRestantes === 0 && r.pesadasRestantes === 0) break;
      }
      setReport(acc);
      router.refresh();
    } catch {
      setError("Não foi possível verificar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={run}
        disabled={busy}
        title="Verifica todas as fotos do catálogo e conserta as que apontam para sites externos"
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-3.5 py-2.5 transition disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageOff className="size-4" />}
        <span className="hidden sm:inline">{busy ? "Verificando..." : "Verificar fotos"}</span>
      </button>

      {error && (
        <p className="text-xs text-rose-600 self-center">{error}</p>
      )}

      {report && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setReport(null)} />
          <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-md p-6 animate-fade-up max-h-[85dvh] overflow-y-auto thin-scroll">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">Relatório das fotos</h3>
              <button onClick={() => setReport(null)} className="text-gray-400 p-1">
                <X className="size-5" />
              </button>
            </div>

            <ul className="text-sm space-y-2">
              <li className="flex items-center gap-2 text-gray-600">
                <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                {report.salvasNoBanco + report.internas} de {report.total} fotos
                estão seguras no sistema.
              </li>
              {report.consertadasAgora > 0 && (
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    <b>{report.consertadasAgora}</b> foto
                    {report.consertadasAgora === 1 ? "" : "s"} de site externo{" "}
                    {report.consertadasAgora === 1 ? "foi baixada" : "foram baixadas"}{" "}
                    e salvas no sistema agora
                    {report.consertadasProdutos.length > 0 && (
                      <span className="block text-xs text-gray-400 mt-0.5">
                        {report.consertadasProdutos.slice(0, 6).join(", ")}
                        {report.consertadasProdutos.length > 6 ? "…" : ""}
                      </span>
                    )}
                  </span>
                </li>
              )}
              {report.otimizadasAgora > 0 && (
                <li className="flex items-start gap-2 text-gray-600">
                  <CheckCircle2 className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>
                    <b>{report.otimizadasAgora}</b> foto
                    {report.otimizadasAgora === 1 ? "" : "s"} pesada
                    {report.otimizadasAgora === 1 ? "" : "s"} (original de câmera){" "}
                    {report.otimizadasAgora === 1 ? "foi comprimida" : "foram comprimidas"}{" "}
                    — eram elas que quebravam no catálogo
                    {report.otimizadasProdutos.length > 0 && (
                      <span className="block text-xs text-gray-400 mt-0.5">
                        {report.otimizadasProdutos.slice(0, 6).join(", ")}
                        {report.otimizadasProdutos.length > 6 ? "…" : ""}
                      </span>
                    )}
                  </span>
                </li>
              )}
              {report.corrompidasRemovidas > 0 && (
                <li className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    <b>{report.corrompidasRemovidas}</b> foto
                    {report.corrompidasRemovidas === 1 ? "" : "s"} corrompida
                    {report.corrompidasRemovidas === 1 ? "" : "s"} (arquivo veio
                    quebrado da importação) {report.corrompidasRemovidas === 1 ? "foi removida" : "foram removidas"} — eram elas que
                    apareciam quebradas no catálogo. Envie a foto de novo nestes
                    produtos:
                    <span className="block text-xs mt-1 leading-relaxed">
                      {report.corrompidasProdutos.join(" · ")}
                    </span>
                  </span>
                </li>
              )}
              {report.falharam.length > 0 && (
                <li className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    Estes produtos estão com foto <b>irrecuperável</b> (o site de
                    origem não respondeu) — abra cada um e envie a foto de novo:
                    <span className="block text-xs mt-1 leading-relaxed">
                      {report.falharam.join(" · ")}
                    </span>
                  </span>
                </li>
              )}
              {report.invalidas.length > 0 && (
                <li className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    Fotos com arquivo <b>corrompido</b> (re-envie):{" "}
                    <span className="text-xs">{report.invalidas.join(" · ")}</span>
                  </span>
                </li>
              )}
              {report.falharam.length === 0 &&
                report.invalidas.length === 0 &&
                report.corrompidasRemovidas === 0 && (
                  <li className="text-emerald-700 text-sm font-medium">
                    Nenhuma foto quebrada — catálogo 100%. 🎉
                  </li>
                )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
