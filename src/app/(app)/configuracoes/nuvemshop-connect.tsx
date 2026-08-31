"use client";

/**
 * Conexão com a Nuvemshop: a loja online vira a dona do estoque/produtos e
 * o AtacadoPro espelha tudo (vendas, clientes, carrinhos abandonados).
 * Conectar = autorizar o app na Nuvemshop (2 cliques por lá).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  FlaskConical,
  Loader2,
  History,
  Stethoscope,
  Power,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Upload,
  X,
} from "lucide-react";
import { Card } from "@/components/ui";
import { Portal } from "@/components/portal";
import { copiarTexto } from "@/lib/copiar";

type Pendencia = {
  produtoNs: string;
  cor: string;
  tamanho: string;
  sku: string | null;
  skuParecido?: string | null;
  repetido?: boolean;
};
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
  report?: {
    at?: string;
    casadas?: number;
    criadas?: number;
    totalPendencias?: number;
    pendencias?: Pendencia[];
  };
};

type RestoreRow = { variantId: string; product: string; color: string; size: string; current: number; proposed: number };

type Achado = {
  tipo: string;
  gravidade: "ALTA" | "MEDIA";
  peca: string;
  detalhe: string;
  estoqueAqui?: number;
  estoqueLa?: number;
};
type Conferencia = {
  produtosNs: number;
  variacoesNs: number;
  variacoesAqui: number;
  vinculadas: number;
  semSku: number;
  resumo: { tipo: string; nome: string; quantos: number }[];
  achados: Achado[];
  /** quantos achados não couberam na lista (contados, nunca sumidos) */
  omitidos?: number;
  /** graves da lista INTEIRA (o servidor conta antes de recortar) */
  graves?: number;
  total: number;
};

export function NuvemshopConnect() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [restore, setRestore] = useState<{ rows: RestoreRow[]; incertas: number } | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [confBusy, setConfBusy] = useState(false);

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
    // trava do link de autorização repassado (RN-023)
    if (q === "outra_loja")
      setMsg(
        "A autorização não pertence a esta loja (ou você não tem permissão de mexer em integrações). Comece clicando em conectar aqui nesta tela."
      );
    if (q === "sem_sessao")
      setMsg(
        "A volta caiu fora do seu login. Faça tudo na mesma janela do navegador e tente de novo."
      );
  }, [carregar]);

  async function sincronizar() {
    setBusy(true);
    setMsg("");
    // EM ETAPAS: cada chamada processa 50 produtos e devolve se acabou.
    // Era numa tacada só, e catálogo grande estourava o tempo do servidor —
    // a sincronização morria no meio sem mensagem (incidente Entre Linhas).
    const falhou = (d: { error?: string }) => {
      setMsg(
        d.error ??
          // resposta sem explicação = o servidor foi interrompido no meio
          "A sincronização foi interrompida no meio. Clique de novo — ela é segura de repetir. Se acontecer sempre, avise o suporte."
      );
      setBusy(false);
    };

    let page = 1;
    let total = 0;
    for (; page <= 200; page++) {
      setMsg(
        page === 1
          ? "Sincronizando…"
          : `Sincronizando… ${total} produtos conferidos até aqui`
      );
      const res = await fetch("/api/nuvemshop/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return falhou(d);
      total += d.produtos ?? 0;
      if (d.fim) break;
    }

    // carrinhos abandonados em etapa PRÓPRIA: importar carrinho cria
    // cliente/conversa — junto com os produtos já derrubou a rodada
    setMsg(`Produtos ok (${total}). Conferindo carrinhos abandonados…`);
    const resC = await fetch("/api/nuvemshop/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrinhos: true }),
    });
    const dC = await resC.json().catch(() => ({}));
    if (!resC.ok) return falhou(dC);

    setMsg(
      `Sincronizado: ${total} produtos conferidos, ${dC.carrinhosNovos ?? 0} carrinho(s) abandonado(s) novo(s).`
    );
    setBusy(false);
    carregar();
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

  async function desfazer() {
    if (
      !window.confirm(
        "Desfazer a importação da Nuvemshop?\n\nIsto REMOVE os produtos que vieram da Nuvemshop e desfaz as ligações. Os produtos que você cadastrou à mão continuam intactos. Use para reimportar do jeito certo (com os SKUs alinhados)."
      )
    )
      return;
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/nuvemshop/undo", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      setMsg(
        `Importação desfeita: ${d.removidos} produto(s) da Nuvemshop removido(s). Agora alinhe os SKUs na Nuvemshop e importe de novo (simule antes).`
      );
      carregar();
    } else setMsg(d.error ?? "Não foi possível desfazer.");
  }

  /**
   * Conferência do vínculo: SÓ LEITURA. "Sincronizou" não é o mesmo que
   * "está certo" — o sync pode dizer 0 pendências e ainda assim ter uma cor
   * morando no produto errado (foi o que houve com o SKU duplicado).
   */
  async function conferir() {
    setConfBusy(true);
    setMsg("");
    setConf(null);
    const res = await fetch("/api/nuvemshop/conferir");
    const d = await res.json().catch(() => null);
    setConfBusy(false);
    if (res.ok && d) setConf(d);
    else setMsg(d?.error ?? "Não foi possível conferir a integração.");
  }

  async function abrirRestore() {
    setRestoreBusy(true);
    setMsg("");
    const res = await fetch("/api/nuvemshop/restore-stock");
    const d = await res.json().catch(() => null);
    setRestoreBusy(false);
    if (res.ok && d) setRestore(d);
    else setMsg(d?.error ?? "Não foi possível calcular a restauração.");
  }

  async function aplicarRestore() {
    setRestoreBusy(true);
    const res = await fetch("/api/nuvemshop/restore-stock", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setRestoreBusy(false);
    setRestore(null);
    if (res.ok) {
      setMsg(`Estoque restaurado: ${d.alterados} variação(ões) voltaram ao valor de antes da importação.`);
      carregar();
    } else setMsg(d.error ?? "Não foi possível restaurar.");
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={sincronizar}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sincronizar agora
            </button>
            <button
              onClick={conferir}
              disabled={busy || confBusy}
              title="Compara peça por peça os dois lados e mostra o que está torto. Não altera nada."
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              {confBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />}
              Conferir integração
            </button>
            <button
              onClick={abrirRestore}
              disabled={busy || restoreBusy}
              title="Recupera o estoque de antes da importação, a partir do histórico (mostra uma prévia antes)"
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-200 hover:border-brand-400 text-brand-700 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              {restoreBusy ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
              Restaurar estoque
            </button>
            <button
              onClick={desfazer}
              disabled={busy}
              title="Remove os produtos que vieram da Nuvemshop e desfaz as ligações (seus produtos próprios ficam)"
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 hover:border-amber-400 text-amber-700 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
              Desfazer importação
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
          {/* o TOTAL de verdade: a lista guardada para no 100 (cabe no
              relatório), e mostrar 100 quando são 240 escondia o problema */}
          <b className={estado.report.pendencias?.length ? "text-amber-700" : "text-emerald-700"}>
            {estado.report.totalPendencias ?? estado.report.pendencias?.length ?? 0} pendência(s)
          </b>
        </div>
      )}
      {estado.connected && (estado.report?.pendencias?.length ?? 0) > 0 && (
        <ListaPendencias
          total={estado.report!.totalPendencias}
          pendencias={estado.report!.pendencias!}
          titulo="⚠️ Variações da Nuvemshop que o sistema NÃO conseguiu casar sozinho:"
          rodape="Como resolver: em Produtos, use o botão SKUs (ou abra a peça) e preencha o SKU da variação com o SKU mostrado acima — ou deixe os nomes de cor/tamanho iguais nos dois lados. Depois toque em Sincronizar agora."
        />
      )}

      {conf && <ResultadoConferencia conf={conf} onFechar={() => setConf(null)} />}

      <SimuladorPreConexao />

      {restore && (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center pb-[var(--kb,0px)]">
            <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => setRestore(null)} />
            <div className="relative flex max-h-[calc(100dvh_-_2rem)] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-pop animate-fade-up md:rounded-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 p-5 pb-3">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <History className="size-5 text-brand-600" />
                  Restaurar estoque
                </h3>
                <button onClick={() => setRestore(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X className="size-5" />
                </button>
              </div>
              <div className="thin-scroll flex-1 overflow-y-auto p-5 pt-3">
                <p className="mb-3 text-sm text-gray-600">
                  Estes são os valores de <b>antes da importação</b>, recuperados do histórico.
                  Confira e confirme — só é aplicado quando você clicar em confirmar.
                </p>
                {restore.rows.length === 0 ? (
                  <p className="rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm p-3">
                    Nada a restaurar: o estoque já está igual ao histórico. 👍
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-100">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-[11px] uppercase text-gray-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Produto</th>
                          <th className="px-2 py-2 text-right font-semibold">Atual</th>
                          <th className="px-2 py-2 text-right font-semibold">Restaurar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {restore.rows.map((r) => (
                          <tr key={r.variantId}>
                            <td className="px-3 py-2">
                              <span className="font-medium text-gray-800">{r.product}</span>
                              <span className="text-gray-400"> · {[r.color, r.size].filter(Boolean).join(" ")}</span>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-rose-600">{r.current}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-700">{r.proposed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {restore.incertas > 0 && (
                  <p className="mt-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-xs p-2.5">
                    ⚠️ {restore.incertas} variação(ões) não puderam ser calculadas pelo histórico — essas você ajusta à mão em Produtos.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 p-4">
                <button
                  onClick={() => setRestore(null)}
                  className="rounded-xl border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 transition hover:border-gray-300"
                >
                  Cancelar
                </button>
                {restore.rows.length > 0 && (
                  <button
                    onClick={aplicarRestore}
                    disabled={restoreBusy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-5 py-2 transition disabled:opacity-60"
                  >
                    {restoreBusy ? <Loader2 className="size-4 animate-spin" /> : <History className="size-4" />}
                    Confirmar restauração ({restore.rows.length})
                  </button>
                )}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </Card>
  );
}

/** Como explicar cada achado para quem não é técnico. */
const COMO_RESOLVER: Record<string, string> = {
  COR_FORA_DO_PRODUTO:
    "Crie o produto dessa cor em Produtos e mova as variações para ele (ou apague a cor errada aqui e sincronize de novo).",
  CARIMBO_CRUZADO:
    "O vínculo velho está na frente do SKU novo. Em Produtos, confira o SKU da variação e sincronize de novo.",
  CARIMBO_ORFAO: "A peça foi apagada na Nuvemshop. Confira se ainda deve existir aqui.",
  SKU_DUPLICADO_AQUI: "Deixe cada variação com um SKU único em Produtos.",
  SKU_DUPLICADO_LA: "Corrija o SKU repetido na Nuvemshop e sincronize de novo.",
  BRIGA_DE_SYNC:
    "Confira o estoque dessa peça. O histórico dela (em Produtos) mostra o que cada sincronização fez.",
  ESTOQUE_DIFERENTE: "Sincronize e veja se iguala. Se não igualar, o vínculo pode estar errado.",
};

/**
 * Resultado da conferência do vínculo. É a resposta para "está tudo certo?",
 * que o relatório do sync não dá: ele conta o que casou, não se casou CERTO.
 */
function ResultadoConferencia({
  conf,
  onFechar,
}: {
  conf: Conferencia;
  onFechar: () => void;
}) {
  // o servidor conta os graves ANTES de recortar a lista; a conta local só
  // enxergava o pedaço que coube na tela (e dizia "200 importantes" sempre)
  const graves = conf.graves ?? conf.achados.filter((a) => a.gravidade === "ALTA").length;
  const limpo = conf.achados.length === 0;
  const [copiado, setCopiado] = useState(false);

  /** Leva a lista inteira para o WhatsApp/e-mail — dá pra trabalhar fora da tela. */
  async function copiarLista() {
    const texto = [
      `Conferência da integração Nuvemshop — ${conf.total} ponto(s)`,
      `Na Nuvemshop: ${conf.produtosNs} produtos / ${conf.variacoesNs} variações · Aqui: ${conf.variacoesAqui} variações`,
      "",
      ...conf.resumo.map((r, i) => `${i + 1}. ${r.quantos}× ${r.nome}`),
      "",
      ...conf.achados.map(
        (a) =>
          `[${a.gravidade}] ${a.peca}${a.estoqueAqui !== undefined ? ` (aqui ${a.estoqueAqui}${a.estoqueLa !== undefined ? ` / lá ${a.estoqueLa}` : ""})` : ""}\n${a.detalhe}`
      ),
      ...(conf.omitidos
        ? ["", `(+ ${conf.omitidos} ponto(s) do mesmo tipo não listados aqui)`]
        : []),
    ].join("\n");
    setCopiado(await copiarTexto(texto));
    setTimeout(() => setCopiado(false), 2500);
  }
  return (
    <div
      className={`mt-3 rounded-xl border p-3 ${
        limpo ? "border-emerald-200 bg-emerald-50/70" : "border-rose-200 bg-rose-50/70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-bold ${limpo ? "text-emerald-800" : "text-rose-800"}`}>
          {limpo
            ? "✅ Integração conferida: tudo casando certo"
            : `⚠️ ${conf.total} ponto(s) para olhar${graves ? ` · ${graves} importante(s)` : ""}`}
        </p>
        <button
          onClick={onFechar}
          className="text-gray-400 hover:text-gray-600 shrink-0"
          aria-label="Fechar conferência"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[11px] text-gray-600 mt-1 leading-snug">
        Na Nuvemshop: <b>{conf.produtosNs}</b> produtos / <b>{conf.variacoesNs}</b> variações ·
        Aqui: <b>{conf.variacoesAqui}</b> variações (<b>{conf.vinculadas}</b> vinculadas
        {conf.semSku > 0 && <>, <b>{conf.semSku}</b> sem SKU</>})
      </p>

      {/* Resumo por tipo: 60 linhas soltas assustam, a lista de tarefas não.
          A ordem aqui é a ordem de consertar. */}
      {!limpo && conf.resumo?.length > 0 && (
        <div className="mt-2 rounded-lg bg-white/70 border border-gray-100 p-2.5">
          <p className="text-[11px] font-bold text-gray-700 mb-1.5">
            Resolva nesta ordem 👇
          </p>
          <ol className="space-y-1">
            {conf.resumo.map((r, i) => (
              <li key={r.tipo} className="text-xs text-gray-700 flex gap-1.5">
                <span className="text-gray-400 shrink-0">{i + 1}.</span>
                <span>
                  <b>{r.quantos}×</b> {r.nome}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!limpo && (
        <ul className="mt-2 space-y-2 max-h-72 overflow-y-auto thin-scroll">
          {conf.achados.map((a, i) => (
            <li
              key={i}
              className="rounded-lg bg-white/80 border border-gray-100 p-2.5 text-xs"
            >
              <p className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    a.gravidade === "ALTA"
                      ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {a.gravidade === "ALTA" ? "IMPORTANTE" : "OLHAR"}
                </span>
                <b className="text-gray-800">{a.peca}</b>
                {a.estoqueAqui !== undefined && (
                  <span className="text-gray-500">
                    · aqui {a.estoqueAqui}
                    {a.estoqueLa !== undefined && ` / lá ${a.estoqueLa}`}
                  </span>
                )}
              </p>
              <p className="text-gray-600 mt-1 leading-snug">{a.detalhe}</p>
              {COMO_RESOLVER[a.tipo] && (
                <p className="text-brand-700 mt-1 leading-snug">
                  <b>O que fazer:</b> {COMO_RESOLVER[a.tipo]}
                </p>
              )}
            </li>
          ))}
          {!!conf.omitidos && (
            <li className="rounded-lg bg-white/60 border border-dashed border-gray-200 p-2.5 text-[11px] text-gray-500">
              + <b>{conf.omitidos}</b> ponto(s) do mesmo tipo não listados aqui (o
              resumo acima conta todos). Resolvendo os de cima, estes costumam
              sair junto — confira de novo depois.
            </li>
          )}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
        <p className="text-[11px] text-gray-500 leading-snug">
          Esta conferência só LÊ os dois lados — não alterou nenhum estoque nem
          produto.
        </p>
        {!limpo && (
          <button
            onClick={copiarLista}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 hover:border-brand-300 text-gray-600 text-[11px] font-medium px-2.5 py-1.5 transition shrink-0"
          >
            <Copy className="size-3" />
            {copiado ? "Copiado!" : "Copiar lista"}
          </button>
        )}
      </div>
    </div>
  );
}

function ListaPendencias({
  pendencias,
  titulo,
  rodape,
  total,
}: {
  pendencias: Pendencia[];
  titulo: string;
  rodape: string;
  /** quantas existem de verdade (a lista guardada para em 100) */
  total?: number;
}) {
  const escondidas = Math.max((total ?? pendencias.length) - pendencias.length, 0);
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
            {/* o quase-igual do cadastro: é o que mostra à lojista O QUE
                difere — sem isso ela via "não casou" e não tinha como
                descobrir o porquê (relato de 31/08/2026) */}
            {p.skuParecido && !p.repetido && (
              <div className="ml-3 text-amber-800">
                ↳ no seu cadastro existe <b>{p.skuParecido}</b> — quase igual.
                Deixe os dois <b>exatamente</b> iguais (confira espaços e
                pontuação) que o estoque passa a puxar.
              </div>
            )}
            {/* SKU igual que mesmo assim não casou = repetido aqui dentro; o
                conselho é outro (deixar único), senão a lojista tenta
                "igualar" dois textos que já são iguais */}
            {p.skuParecido && p.repetido && (
              <div className="ml-3 text-amber-800">
                ↳ este SKU está <b>repetido</b> em mais de uma variação do seu
                cadastro. Deixe cada peça com um SKU só dela que o estoque
                passa a puxar.
              </div>
            )}
          </li>
        ))}
      </ul>
      {/* lista cortada: dizer quantas ficaram de fora, senão a lojista
          conserta 100 e acha que acabou (achado da revisão 31/08/2026) */}
      {escondidas > 0 && (
        <p className="text-[11px] font-semibold text-amber-800 mt-1.5">
          + {escondidas} não listada(s) aqui — resolva estas e sincronize de novo
          para ver as próximas.
        </p>
      )}
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
              rodape="Como resolver antes de importar: a integração casa SÓ por SKU. Em Produtos, use o botão SKUs pra preencher, em cada variação da sua loja, o mesmo SKU que aparece na Nuvemshop (mostrado acima). Variação sem SKU não é importada. Depois rode a simulação de novo pra conferir."
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
