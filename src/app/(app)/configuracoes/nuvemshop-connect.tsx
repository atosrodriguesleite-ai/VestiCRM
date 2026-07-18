"use client";

/**
 * Conexão com a Nuvemshop: a loja online vira a dona do estoque/produtos e
 * o AtacadoPro espelha tudo (vendas, clientes, carrinhos abandonados).
 * Conectar = autorizar o app na Nuvemshop (2 cliques por lá).
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Power, RefreshCw, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui";

type Pendencia = { produtoNs: string; cor: string; tamanho: string; sku: string | null };
type Estado = {
  serverConfigured: boolean;
  connected: boolean;
  storeId: string | null;
  lastProductSync: string | null;
  lastCheckoutSync: string | null;
  produtos: number;
  vendas: number;
  report?: { at?: string; casadas?: number; criadas?: number; pendencias?: Pendencia[] };
};

export function NuvemshopConnect() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const carregar = useCallback(async () => {
    const res = await fetch("/api/nuvemshop");
    if (res.ok) setEstado(await res.json());
  }, []);

  useEffect(() => {
    carregar();
    // retorno do OAuth (?nuvemshop=ok|erro) — mostra o resultado
    const q = new URLSearchParams(window.location.search).get("nuvemshop");
    if (q === "ok") setMsg("Loja conectada! A primeira importação de produtos já começou.");
    if (q === "erro") setMsg("A conexão não foi concluída — tente de novo.");
  }, [carregar]);

  async function sincronizar() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/nuvemshop/sync", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(`Sincronizado: ${d.produtos} produtos conferidos, ${d.carrinhosNovos} carrinho(s) abandonado(s) novo(s).`);
      carregar();
    } else setMsg(d.error ?? "Não foi possível sincronizar.");
  }

  async function desconectar() {
    if (!window.confirm("Desconectar a Nuvemshop? Os dados já importados ficam; nada é apagado."))
      return;
    setBusy(true);
    await fetch("/api/nuvemshop", { method: "DELETE" });
    setBusy(false);
    setMsg("");
    carregar();
  }

  if (!estado) return null;

  return (
    <Card className="p-5 mb-6">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <ShoppingCart className="size-4 text-brand-600" />
          Loja online — Nuvemshop
        </h2>
        {estado.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1">
            <CheckCircle2 className="size-3.5" />
            Conectada · loja #{estado.storeId}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        A Nuvemshop passa a mandar no estoque e nos produtos; o AtacadoPro
        espelha tudo sozinho: vendas entram pagas, clientes caem no CRM,
        carrinhos abandonados viram cards no funil — e as vendas do catálogo
        devolvem a baixa de estoque pra lá.
      </p>

      {!estado.serverConfigured ? (
        <p className="rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm p-3">
          A integração ainda não foi ativada pela plataforma. Assim que for, o
          botão de conectar aparece aqui.
        </p>
      ) : !estado.connected ? (
        <a
          href="/api/nuvemshop/connect"
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2.5 transition"
        >
          <ShoppingCart className="size-4" />
          Conectar minha Nuvemshop
        </a>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">
            <b>{estado.produtos}</b> produtos espelhados · <b>{estado.vendas}</b>{" "}
            vendas importadas
            {estado.lastCheckoutSync &&
              ` · carrinhos conferidos ${new Date(estado.lastCheckoutSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={sincronizar}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sincronizar agora
            </button>
            <button
              onClick={desconectar}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              <Power className="size-3.5" />
              Desconectar
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p className="text-sm text-brand-700 bg-brand-50 rounded-lg px-3 py-2 mt-3">{msg}</p>
      )}

      {/* Relatório de vínculo: o que casou e o que precisa de ajuste manual */}
      {estado.connected && estado.report?.at !== undefined && (
        <div className="mt-3 text-xs text-gray-500">
          Última conferência:{" "}
          <b className="text-emerald-700">{estado.report.casadas ?? 0} variações casadas</b> ·{" "}
          {estado.report.criadas ?? 0} produto(s) novo(s) espelhado(s) ·{" "}
          <b className={estado.report.pendencias?.length ? "text-amber-700" : "text-emerald-700"}>
            {estado.report.pendencias?.length ?? 0} pendência(s)
          </b>
        </div>
      )}
      {estado.connected && (estado.report?.pendencias?.length ?? 0) > 0 && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-xs font-bold text-amber-800 mb-1.5">
            ⚠️ Variações da Nuvemshop que o sistema NÃO conseguiu casar sozinho:
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto thin-scroll">
            {estado.report!.pendencias!.map((p, i) => (
              <li key={i} className="text-xs text-amber-900">
                • <b>{p.produtoNs}</b> — {p.cor} · {p.tamanho}
                {p.sku && (
                  <span className="text-amber-700"> (SKU na Nuvemshop: <b>{p.sku}</b>)</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-700 mt-2 leading-snug">
            Como resolver: em <b>Produtos</b>, abra a peça correspondente e
            preencha o <b>SKU da variação</b> (campo novo na grade) com o SKU
            mostrado acima — ou deixe os nomes de cor/tamanho iguais nos dois
            lados. Depois toque em <b>Sincronizar agora</b>.
          </p>
        </div>
      )}
    </Card>
  );
}
