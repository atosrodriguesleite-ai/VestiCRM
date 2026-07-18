"use client";

/**
 * Conexão com a Nuvemshop: a loja online vira a dona do estoque/produtos e
 * o AtacadoPro espelha tudo (vendas, clientes, carrinhos abandonados).
 * Conectar = autorizar o app na Nuvemshop (2 cliques por lá).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  FlaskConical,
  Loader2,
  Power,
  RefreshCw,
  ShoppingCart,
  Upload,
} from "lucide-react";
import { Card } from "@/components/ui";

type Pendencia = { produtoNs: string; cor: string; tamanho: string; sku: string | null };
type Simulacao = {
  produtosNs: number;
  variacoesNs: number;
  casariam: number;
  criariam: string[];
  pendencias: Pendencia[];
};
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
        <ListaPendencias
          pendencias={estado.report!.pendencias!}
          titulo="⚠️ Variações da Nuvemshop que o sistema NÃO conseguiu casar sozinho:"
          rodape="Como resolver: em Produtos, use o botão SKUs (ou abra a peça) e preencha o SKU da variação com o SKU mostrado acima — ou deixe os nomes de cor/tamanho iguais nos dois lados. Depois toque em Sincronizar agora."
        />
      )}

      <SimuladorPreConexao />
    </Card>
  );
}

function ListaPendencias({
  pendencias,
  titulo,
  rodape,
}: {
  pendencias: Pendencia[];
  titulo: string;
  rodape: string;
}) {
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
      <p className="text-xs font-bold text-amber-800 mb-1.5">{titulo}</p>
      <ul className="space-y-1 max-h-40 overflow-y-auto thin-scroll">
        {pendencias.map((p, i) => (
          <li key={i} className="text-xs text-amber-900">
            • <b>{p.produtoNs}</b> — {p.cor} · {p.tamanho}
            {p.sku && (
              <span className="text-amber-700"> (SKU na Nuvemshop: <b>{p.sku}</b>)</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-amber-700 mt-2 leading-snug">{rodape}</p>
    </div>
  );
}

/**
 * Teste ANTES de conectar: o lojista exporta a planilha de produtos da
 * Nuvemshop e sobe aqui — o sistema mostra o que casaria, o que entraria
 * novo e as pendências, sem criar nem alterar nada.
 */
function SimuladorPreConexao() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState("");
  const [sim, setSim] = useState<Simulacao | null>(null);

  async function processar(file: File) {
    setRodando(true);
    setErro("");
    setSim(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/nuvemshop/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setSim(d as Simulacao);
      else setErro(d.error ?? "Não foi possível simular.");
    } catch {
      setErro("Não foi possível ler o arquivo.");
    }
    setRodando(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed border-gray-300 p-3.5">
      <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-1">
        <FlaskConical className="size-3.5 text-brand-600" />
        Teste antes de conectar (simulação)
      </p>
      <p className="text-xs text-gray-500 mb-2.5 leading-snug">
        Na Nuvemshop, vá em <b>Produtos → Exportar</b> e baixe a planilha
        (CSV). Suba o arquivo aqui pra ver o que vai casar com o seu catálogo,
        o que entraria novo e o que ficaria pendente — <b>nada é criado nem
        alterado</b>, é só uma prévia.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processar(f);
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={rodando}
        className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
      >
        {rodando ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Upload className="size-3.5" />
        )}
        Enviar planilha da Nuvemshop
      </button>
      {erro && (
        <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-2">{erro}</p>
      )}
      {sim && (
        <div className="mt-3">
          <p className="text-xs text-gray-600">
            Planilha lida: <b>{sim.produtosNs}</b> produto(s) ·{" "}
            <b>{sim.variacoesNs}</b> variação(ões). Resultado:{" "}
            <b className="text-emerald-700">{sim.casariam} variações casariam</b> ·{" "}
            {sim.criariam.length} produto(s) entrariam novos ·{" "}
            <b className={sim.pendencias.length ? "text-amber-700" : "text-emerald-700"}>
              {sim.pendencias.length} pendência(s)
            </b>
          </p>
          {sim.criariam.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
              Entrariam como produtos novos:{" "}
              {sim.criariam.slice(0, 12).join(", ")}
              {sim.criariam.length > 12 && ` e mais ${sim.criariam.length - 12}…`}
            </p>
          )}
          {sim.pendencias.length > 0 ? (
            <ListaPendencias
              pendencias={sim.pendencias}
              titulo="⚠️ Variações que NÃO casariam sozinhas:"
              rodape="Como resolver antes de conectar: em Produtos, use o botão SKUs pra preencher o SKU de cada variação com o SKU mostrado acima — ou deixe os nomes de cor/tamanho iguais nos dois lados. Depois rode a simulação de novo pra conferir."
            />
          ) : (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mt-2">
              ✅ Tudo casaria certinho — pode conectar sem medo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
