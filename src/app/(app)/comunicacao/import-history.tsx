"use client";

import { useState } from "react";
import { History, Loader2, CheckCircle2, Download } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Importa o histórico recente (últimos 30 dias) do WhatsApp conectado. Baixo
 * risco: lê só o lote que o WhatsApp já sincronizou ao conectar.
 */
export function ImportHistory({ connected }: { connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    importadas: number;
    conversas: number;
    encontradas: number;
    semData?: number;
    naJanela?: number;
  } | null>(null);
  const [erro, setErro] = useState("");

  async function importar() {
    if (
      !window.confirm(
        "Importar as conversas dos últimos 30 dias (com áudios)? Elas entram no histórico (aba Contatos), organizadas por cliente. Pode levar alguns minutos."
      )
    )
      return;
    setBusy(true);
    setErro("");
    setDone(null);
    const res = await fetch("/api/comm/import-history", { method: "POST" });
    setBusy(false);
    // resposta sem JSON = a importação foi interrompida no meio (tempo/queda)
    const d = await res.json().catch(() => null);
    if (res.ok && d)
      setDone({
        importadas: d.importadas,
        conversas: d.conversas,
        encontradas: d.encontradas,
        semData: d.semData,
        naJanela: d.naJanela,
      });
    else if (!d)
      setErro(
        `A importação foi interrompida antes de terminar (código ${res.status}). ` +
          "Parte do histórico pode ter entrado — toque de novo para continuar de onde parou."
      );
    else setErro(d.error ?? "Não foi possível importar agora.");
  }

  if (!connected) return null;

  return (
    <Card className="p-5 mb-5">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <History className="size-4 text-brand-600" />
        Importar conversas recentes
      </h2>
      <p className="text-sm text-gray-500 mb-3">
        Traz as conversas dos <b>últimos 30 dias</b> (com <b>áudios</b>) que o
        WhatsApp já sincronizou ao conectar — organizadas por cliente, no
        histórico, e sem risco extra pro número. Pode levar alguns minutos.
      </p>

      {done ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <CheckCircle2 className="size-4 shrink-0" />
          {done.importadas > 0
            ? `Pronto! ${done.importadas} mensagem(ns) importada(s) em ${done.conversas} conversa(s). Veja na aba Contatos do atendimento. 🎉`
            : `O servidor devolveu ${done.encontradas ?? 0} mensagem(ns) guardada(s). ${
                (done.encontradas ?? 0) === 0
                  ? "Isso indica que o servidor não está guardando o histórico — dá pra ligar essa opção nas configurações dele."
                  : (done.naJanela ?? 0) === 0
                    ? `Nenhuma delas é dos últimos 30 dias${
                        (done.semData ?? 0) > 0
                          ? ` (e ${done.semData} vieram sem data legível)`
                          : ""
                      } — o histórico guardado no servidor é mais antigo que isso.`
                    : "Todas essas já estavam no sistema (nada novo para trazer)."
              }`}
        </p>
      ) : (
        <>
          <button
            onClick={importar}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy ? "Importando…" : "Importar últimos 30 dias"}
          </button>
          {erro && (
            <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{erro}</p>
          )}
        </>
      )}
    </Card>
  );
}
