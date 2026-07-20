"use client";

/**
 * Integração Jueri (admin): conectar com token + ID do cliente, SIMULAR a
 * importação (relatório do que aconteceria, sem gravar nada) e IMPORTAR de
 * verdade — página por página, com progresso, pra aguentar catálogo grande.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui";

type Resumo = {
  processados: number;
  novos: number;
  atualizados: number;
  ignorados: number;
  comFoto: number;
  semFoto: number;
  coresNovas: number;
};

const zerado: Resumo = {
  processados: 0, novos: 0, atualizados: 0, ignorados: 0,
  comFoto: 0, semFoto: 0, coresNovas: 0,
};

export function JueriConnect() {
  const router = useRouter();
  const [estado, setEstado] = useState<{
    conectado: boolean;
    clienteSistema?: string;
    lastSyncAt?: string | null;
  } | null>(null);
  const [token, setToken] = useState("");
  const [clienteSistema, setClienteSistema] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [progresso, setProgresso] = useState("");
  const [resultado, setResultado] = useState<{ simulado: boolean; r: Resumo } | null>(null);

  useEffect(() => {
    fetch("/api/jueri/conectar")
      .then((r) => r.json())
      .then(setEstado)
      .catch(() => setEstado({ conectado: false }));
  }, []);

  async function conectar() {
    setBusy(true);
    setErro("");
    const res = await fetch("/api/jueri/conectar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim(), clienteSistema: clienteSistema.trim() }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setErro(data.error ?? "Não foi possível conectar.");
      return;
    }
    setToken("");
    setEstado({ conectado: true, clienteSistema: clienteSistema.trim(), lastSyncAt: null });
  }

  async function desconectar() {
    if (!window.confirm("Desconectar a Jueri? Os produtos já importados continuam aqui.")) return;
    setBusy(true);
    await fetch("/api/jueri/conectar", { method: "DELETE" });
    setBusy(false);
    setEstado({ conectado: false });
    setResultado(null);
  }

  async function sincronizar(simular: boolean) {
    setBusy(true);
    setErro("");
    setResultado(null);
    const total: Resumo = { ...zerado };
    let pagina = 1;
    try {
      for (;;) {
        setProgresso(`página ${pagina}… (${total.processados} produtos até agora)`);
        const res = await fetch("/api/jueri/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pagina, simular }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErro(data.error ?? "Falha na sincronização.");
          break;
        }
        for (const k of Object.keys(total) as (keyof Resumo)[]) {
          total[k] += data.resumo?.[k] ?? 0;
        }
        if (!data.temMais) {
          setResultado({ simulado: simular, r: total });
          if (!simular) router.refresh();
          break;
        }
        pagina += 1;
        if (pagina > 500) break; // trava de segurança
      }
    } catch {
      setErro("Falha na chamada — tente de novo.");
    }
    setProgresso("");
    setBusy(false);
  }

  if (!estado) return null;

  return (
    <Card className="p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Plug className="size-4 text-brand-600" />
        Integração Jueri
      </h2>
      <p className="text-xs text-gray-500 mb-4">
        Importa o catálogo do sistema Jueri: itens com SKU, preço de varejo e
        de atacado, estoque, cor e fotos. Simule antes — nada é gravado até
        você importar.
      </p>

      {!estado.conectado ? (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <input
              value={clienteSistema}
              onChange={(e) => setClienteSistema(e.target.value)}
              placeholder="ID do cliente (ex.: 10422)"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm w-44 bg-white"
            />
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Token de integração (Jueri → Configurações → API)"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm flex-1 min-w-[220px] bg-white"
            />
            <button
              onClick={conectar}
              disabled={busy || !token.trim() || !clienteSistema.trim()}
              className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-50"
            >
              {busy ? "Conectando…" : "Conectar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            🟢 Conectada — cliente <b className="font-mono">{estado.clienteSistema}</b>
            {estado.lastSyncAt && (
              <span className="text-gray-400 text-xs">
                {" "}· última importação {new Date(estado.lastSyncAt).toLocaleString("pt-BR")}
              </span>
            )}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => sincronizar(true)}
              disabled={busy}
              className="rounded-xl border border-gray-200 hover:border-brand-300 text-gray-700 text-sm font-medium px-4 py-2 transition disabled:opacity-50"
            >
              Simular importação
            </button>
            <button
              onClick={() => sincronizar(false)}
              disabled={busy}
              className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 transition disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
              Importar / atualizar catálogo
            </button>
            <button
              onClick={desconectar}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-rose-600 px-2 transition"
            >
              Desconectar
            </button>
          </div>
        </div>
      )}

      {progresso && <p className="text-xs text-gray-500 mt-3 animate-pulse">⏳ {progresso}</p>}
      {erro && (
        <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mt-3">
          {erro}
        </p>
      )}
      {resultado && (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-1">
          <p className="font-semibold text-emerald-700">
            {resultado.simulado ? "Simulação concluída (nada foi gravado):" : "Importação concluída! 🎉"}
          </p>
          <p>
            {resultado.r.processados} produtos lidos · <b>{resultado.r.novos} novos</b> ·{" "}
            {resultado.r.atualizados} atualizados
            {resultado.r.ignorados > 0 && ` · ${resultado.r.ignorados} inativos ignorados`}
          </p>
          <p className="text-xs text-gray-600">
            📸 {resultado.r.comFoto} com foto · {resultado.r.semFoto} sem foto
            {resultado.r.coresNovas > 0 && ` · 🎨 ${resultado.r.coresNovas} cores novas na biblioteca`}
          </p>
        </div>
      )}
    </Card>
  );
}
