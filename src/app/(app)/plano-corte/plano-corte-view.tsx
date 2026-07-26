"use client";

/**
 * Plano de Corte Inteligente — tela completa:
 *   1. Biblioteca de modelos (upload .adsx/DXF + anexar curvas via PDF)
 *   2. Carrinho do corte: VÁRIOS modelos juntos (mesmo tecido/largura),
 *      grade por modelo, peças liga/desliga, tecido/mesa e o MODO de
 *      otimização (quanto tempo o sistema pensa)
 *   3. Otimização ao vivo: barra de %, cronômetro, frases de "pensando",
 *      tentativas reais e o plano MELHORANDO na tela; botão "Parar e usar"
 *   4. Fila: até 3 planos calculando ao mesmo tempo — continuam de onde
 *      pararam se a página recarregar
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Paperclip,
  Plus,
  Ruler,
  Scissors,
  Shirt,
  Sparkles,
  Square,
  Trash2,
  TrendingDown,
  UploadCloud,
  X,
} from "lucide-react";
import { Button, Card, EmptyState, Field, Input, inputCls } from "@/components/ui";
import { ehPecaPar, quantidadeSugerida } from "@/lib/plano-corte/types";

/* ---------- tipos espelhando as APIs ---------- */

type ModeloResumo = {
  id: string;
  name: string;
  source: string;
  thumbnail: string | null;
  sizes: string[];
  pieces: { nome: string; pano: string; temContorno: boolean }[];
  createdAt: string;
};

type ModeloDetalhe = {
  id: string;
  name: string;
  thumbnail: string | null;
  sizes: string[];
  pieces: {
    nome: string;
    pano: "TEC" | "FOR";
    qtd: number;
    desc?: string;
    espelhada?: boolean;
    tamanhos: Record<string, { w: number; h: number; area: number; contorno?: unknown }>;
  }[];
};

type Progresso = {
  id: string;
  nome: string | null;
  status: string;
  modo: string | null;
  pct: number;
  budgetMs: number;
  elapsedMs: number;
  restanteMs: number;
  tentativas: number;
  fase: string | null;
  criadoEm: string;
  aproveitamento: number | null;
  panos: { pano: string; totalM: number; riscos: number; aproveitamento: number }[];
  modelName?: string | null;
  modelos?: number;
  totalPecasRoupa?: number;
};

type RiscoResp = {
  combo: Record<string, number>;
  rotulo?: string;
  folhas: number;
  enfestos: number;
  comprimentoCm: number;
  larguraCm: number;
  aproveitamento: number;
  estrategiaEncaixe: string;
  svg: string;
};

type PlanoResp = {
  pano: "TEC" | "FOR";
  riscos: RiscoResp[];
  totalTecidoCm: number;
  aproveitamentoMedio: number;
  estrategiaEnfesto: string;
  comparativo: { estrategia: string; totalTecidoCm: number }[];
  avisos: string[];
};

type DetalhePlano = Progresso & {
  params?: { perdaPorFolhaCm?: number } | null;
  resultado: {
    planos: PlanoResp[];
    totalPecasRoupa: number;
    analises: number;
  } | null;
};

type ItemCarrinho = {
  detalhe: ModeloDetalhe;
  grade: Record<string, string>;
  pecasDesligadas: Set<string>;
};

/* ---------- helpers ---------- */

const fmtM = (cm: number) =>
  `${(cm / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m`;

const fmtTempo = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function arquivoParaBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK)
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

const PANO_LABEL: Record<string, string> = { TEC: "Tecido", FOR: "Forro" };

const MODOS = [
  { id: "RAPIDO", label: "Rápido", tempo: "~30s", desc: "primeiro plano bom" },
  { id: "NORMAL", label: "Normal", tempo: "~3min", desc: "equilíbrio (recomendado)" },
  { id: "CAPRICHADO", label: "Caprichado", tempo: "~10min", desc: "espreme cada cm" },
];

const FRASES_PENSANDO = [
  "🧠 Pensando nas combinações de tamanhos...",
  "🧩 Tentando encaixar a manga no vão da cava...",
  "🔄 Girando peças pra ganhar milímetros...",
  "📏 Medindo o risco de ponta a ponta...",
  "🎲 Testando ordens que ninguém pensaria...",
  "✂️ Raspando os últimos centímetros de tecido...",
  "🧵 Casando curva com curva, sem desperdício...",
  "🔬 Passando a lupa fina nos vãos...",
];

/* ---------- componente principal ---------- */

export function PlanoCorteView() {
  const [modelos, setModelos] = useState<ModeloResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [abrindoModelo, setAbrindoModelo] = useState<string | null>(null);

  // configuração do plano
  const [nomePlano, setNomePlano] = useState("");
  const [incluirForro, setIncluirForro] = useState(true);
  // forro cortado no mesmo pano do tecido (um risco só, uma metragem só)
  const [forroMesmoTecido, setForroMesmoTecido] = useState(false);
  const [larguraTecido, setLarguraTecido] = useState("160");
  const [larguraForro, setLarguraForro] = useState("");
  const [mesa, setMesa] = useState("500");
  const [folga, setFolga] = useState("0,5");
  const [sentidoUnico, setSentidoUnico] = useState(false);
  const [modo, setModo] = useState("NORMAL");

  // jobs (fila + histórico) e visualização
  const [lista, setLista] = useState<Progresso[]>([]);
  const [detalhe, setDetalhe] = useState<DetalhePlano | null>(null);
  const [criando, setCriando] = useState(false);
  const dirigindo = useRef<Set<string>>(new Set());
  const detalheRef = useRef<string | null>(null);
  const [, forceTick] = useState(0); // cronômetro re-renderiza a cada 1s
  const sync = useRef<Map<string, number>>(new Map()); // id → timestamp do último update

  const [editandoQtd, setEditandoQtd] = useState<string | null>(null); // modelId
  const [msgCurvas, setMsgCurvas] = useState<string | null>(null);
  const [anexandoCurvas, setAnexandoCurvas] = useState(false);
  const curvasPara = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const curvasInput = useRef<HTMLInputElement>(null);
  const resultadoRef = useRef<HTMLDivElement>(null);
  const [fraseIdx, setFraseIdx] = useState(0);

  /* ---------- carregamento ---------- */

  const carregarModelos = useCallback(async () => {
    try {
      const r = await fetch("/api/plano-corte/modelos");
      if (r.ok) setModelos(await r.json());
    } catch {
      setErro("Sem conexão — tente de novo");
    }
  }, []);

  const carregarLista = useCallback(async () => {
    try {
      const r = await fetch("/api/plano-corte/gerar");
      if (!r.ok) return;
      const dados: Progresso[] = await r.json();
      setLista(dados);
      for (const d of dados) sync.current.set(d.id, Date.now());
      return dados;
    } catch {
      /* silencioso */
    }
  }, []);

  const atualizarDetalhe = useCallback(async (id: string) => {
    const r = await fetch(`/api/plano-corte/planos/${id}`);
    if (!r.ok) return;
    const d: DetalhePlano = await r.json();
    if (detalheRef.current === id) setDetalhe(d);
  }, []);

  /** Loop de rodadas: chama /rodada até concluir. É ele que move a barra. */
  const dirigir = useCallback(
    async (id: string) => {
      if (dirigindo.current.has(id)) return;
      dirigindo.current.add(id);
      try {
        for (let i = 0; i < 500; i++) {
          const r = await fetch(`/api/plano-corte/planos/${id}/rodada`, {
            method: "POST",
          });
          if (!r.ok) break;
          const p: Progresso = await r.json();
          sync.current.set(id, Date.now());
          setLista((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
          if (detalheRef.current === id) await atualizarDetalhe(id);
          if (p.status !== "EM_ANDAMENTO") break;
        }
      } finally {
        dirigindo.current.delete(id);
        await carregarLista();
        if (detalheRef.current === id) await atualizarDetalhe(id);
      }
    },
    [atualizarDetalhe, carregarLista]
  );

  useEffect(() => {
    carregarModelos();
    // retoma planos que ficaram calculando (página fechou no meio)
    carregarLista().then((dados) => {
      for (const d of dados ?? [])
        if (d.status === "EM_ANDAMENTO") dirigir(d.id);
    });
    const tick = setInterval(() => forceTick((t) => t + 1), 1000);
    const frase = setInterval(
      () => setFraseIdx((i) => (i + 1) % FRASES_PENSANDO.length),
      4000
    );
    return () => {
      clearInterval(tick);
      clearInterval(frase);
    };
  }, [carregarModelos, carregarLista, dirigir]);

  /* ---------- upload de modelo ---------- */

  const enviarArquivo = useCallback(
    async (file: File) => {
      setErro(null);
      setEnviando(true);
      try {
        const contentBase64 = await arquivoParaBase64(file);
        const r = await fetch("/api/plano-corte/modelos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentBase64 }),
        });
        const data = await r.json();
        if (!r.ok) {
          setErro(data.error ?? "Não consegui ler o arquivo");
          return;
        }
        await carregarModelos();
      } catch {
        setErro("Falha no envio — tente de novo");
      } finally {
        setEnviando(false);
      }
    },
    [carregarModelos]
  );

  /* ---------- curvas (PDF) ---------- */

  async function anexarCurvas(file: File) {
    const modelId = curvasPara.current;
    if (!modelId) return;
    setMsgCurvas(null);
    setErro(null);
    setAnexandoCurvas(true);
    try {
      const contentBase64 = await arquivoParaBase64(file);
      const r = await fetch(`/api/plano-corte/modelos/${modelId}/curvas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? "Não consegui ler as curvas");
        return;
      }
      setMsgCurvas(
        `Curvas anexadas: ${data.casadas} de ${data.totalAlvos} peças ganharam a curva real 🎉`
      );
      await carregarModelos();
      // atualiza o item do carrinho, se o modelo estiver nele
      const det = await fetch(`/api/plano-corte/modelos/${modelId}`);
      if (det.ok) {
        const dd: ModeloDetalhe = await det.json();
        setCarrinho((c) =>
          c.map((item) => (item.detalhe.id === modelId ? { ...item, detalhe: dd } : item))
        );
      }
    } catch {
      setErro("Falha no envio — tente de novo");
    } finally {
      setAnexandoCurvas(false);
    }
  }

  /* ---------- carrinho ---------- */

  async function adicionarAoCorte(id: string) {
    if (carrinho.some((i) => i.detalhe.id === id)) {
      setCarrinho((c) => c.filter((i) => i.detalhe.id !== id));
      return;
    }
    if (carrinho.length >= 6) {
      setErro("Máximo de 6 modelos por corte");
      return;
    }
    setAbrindoModelo(id);
    setErro(null);
    try {
      const r = await fetch(`/api/plano-corte/modelos/${id}`);
      if (!r.ok) return;
      const det: ModeloDetalhe = await r.json();
      setCarrinho((c) => [
        ...c,
        {
          detalhe: det,
          grade: Object.fromEntries(det.sizes.map((s) => [s, ""])),
          pecasDesligadas: new Set<string>(),
        },
      ]);
    } finally {
      setAbrindoModelo(null);
    }
  }

  /** Corrige quantas vezes cada peça é cortada por roupa (manga = 2, etc.). */
  async function salvarQuantidades(
    modelId: string,
    pecas: { nome: string; qtd: number; espelhada?: boolean }[]
  ) {
    const r = await fetch(`/api/plano-corte/modelos/${modelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pecas }),
    });
    if (!r.ok) {
      setErro("Não consegui salvar as quantidades");
      return;
    }
    const d = await r.json();
    setCarrinho((c) =>
      c.map((item) =>
        item.detalhe.id === modelId
          ? { ...item, detalhe: { ...item.detalhe, pieces: d.pieces } }
          : item
      )
    );
    setEditandoQtd(null);
  }

  async function excluirModelo(id: string) {
    if (!confirm("Excluir este modelo e seus planos salvos?")) return;
    await fetch(`/api/plano-corte/modelos/${id}`, { method: "DELETE" });
    setCarrinho((c) => c.filter((i) => i.detalhe.id !== id));
    await carregarModelos();
  }

  /* ---------- criar plano ---------- */

  const num = (s: string, padrao: number) => {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : padrao;
  };

  async function montarPlano() {
    const itens = carrinho
      .map((item) => {
        const grade: Record<string, number> = {};
        for (const [t, v] of Object.entries(item.grade)) {
          const n = parseInt(v, 10);
          if (n > 0) grade[t] = n;
        }
        return {
          modelId: item.detalhe.id,
          grade,
          pecasDesligadas: [
            ...item.pecasDesligadas,
            ...(!incluirForro
              ? item.detalhe.pieces.filter((p) => p.pano === "FOR").map((p) => p.nome)
              : []),
          ],
        };
      })
      .filter((i) => Object.keys(i.grade).length > 0);
    if (itens.length === 0) {
      setErro("Informe a quantidade de pelo menos um tamanho");
      return;
    }
    setErro(null);
    setCriando(true);
    try {
      const r = await fetch("/api/plano-corte/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nomePlano.trim() || undefined,
          modo,
          itens,
          larguraTecidoCm: num(larguraTecido, 160),
          larguraForroCm: larguraForro.trim() ? num(larguraForro, 160) : undefined,
          mesaCm: num(mesa, 500),
          folgaCm: num(folga, 0.5),
          incluirForro,
          forroMesmoTecido,
          sentidoUnico,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? "Não consegui montar o plano");
        return;
      }
      detalheRef.current = data.id;
      sync.current.set(data.id, Date.now());
      await carregarLista();
      await atualizarDetalhe(data.id);
      if (data.status === "EM_ANDAMENTO") dirigir(data.id);
      setTimeout(
        () => resultadoRef.current?.scrollIntoView({ behavior: "smooth" }),
        120
      );
    } catch {
      setErro("Falha ao criar o plano — tente de novo");
    } finally {
      setCriando(false);
    }
  }

  async function abrirPlano(id: string) {
    detalheRef.current = id;
    setDetalhe(null);
    await atualizarDetalhe(id);
    const p = lista.find((l) => l.id === id);
    if (p?.status === "EM_ANDAMENTO") dirigir(id);
    setTimeout(() => resultadoRef.current?.scrollIntoView({ behavior: "smooth" }), 120);
  }

  async function pararPlano(id: string) {
    await fetch(`/api/plano-corte/planos/${id}/parar`, { method: "POST" });
    await carregarLista();
    if (detalheRef.current === id) await atualizarDetalhe(id);
  }

  async function excluirPlano(id: string) {
    if (!confirm("Apagar este plano?")) return;
    await fetch(`/api/plano-corte/planos/${id}`, { method: "DELETE" });
    if (detalheRef.current === id) {
      detalheRef.current = null;
      setDetalhe(null);
    }
    await carregarLista();
  }

  /* ---------- derivados ---------- */

  const emAndamento = lista.filter((l) => l.status === "EM_ANDAMENTO");
  const historico = lista.filter((l) => l.status !== "EM_ANDAMENTO");
  const temForro = carrinho.some((i) => i.detalhe.pieces.some((p) => p.pano === "FOR"));
  const totalPecasCarrinho = carrinho.reduce(
    (s, i) =>
      s + Object.values(i.grade).reduce((a, v) => a + (parseInt(v, 10) || 0), 0),
    0
  );

  /** Cronômetro suave: tempo do servidor + o que passou desde o último sync. */
  const tempoVivo = (p: Progresso) => {
    if (p.status !== "EM_ANDAMENTO") return p.elapsedMs;
    const desde = sync.current.get(p.id);
    return Math.min(p.budgetMs, p.elapsedMs + (desde ? Date.now() - desde : 0));
  };
  const pctVivo = (p: Progresso) =>
    p.status !== "EM_ANDAMENTO"
      ? 100
      : Math.min(99, Math.round((tempoVivo(p) / Math.max(1, p.budgetMs)) * 100));

  /* ---------- render ---------- */

  return (
    <div className="space-y-6">
      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erro}
        </div>
      )}
      {msgCurvas && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {msgCurvas}
        </div>
      )}

      {/* ============ FILA: PLANOS CALCULANDO ============ */}
      {emAndamento.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
            <Loader2 className="size-4 animate-spin text-brand-600" />
            Planos calculando ({emAndamento.length}/3)
          </h2>
          <div className="space-y-3">
            {emAndamento.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => abrirPlano(p.id)}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {p.nome || p.modelName || "Plano de corte"}
                      {(p.modelos ?? 1) > 1 && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          {p.modelos} modelos
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      ⏱️ {fmtTempo(tempoVivo(p))} de {fmtTempo(p.budgetMs)} · faltam ~
                      {fmtTempo(Math.max(0, p.budgetMs - tempoVivo(p)))} ·{" "}
                      {p.tentativas.toLocaleString("pt-BR")} encaixes testados
                      {p.aproveitamento ? ` · melhor: ${p.aproveitamento}%` : ""}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => pararPlano(p.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-amber-300 hover:text-amber-700"
                    >
                      <Square className="size-3" /> Parar e usar
                    </button>
                    <button
                      type="button"
                      onClick={() => excluirPlano(p.id)}
                      className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-1000"
                    style={{ width: `${pctVivo(p)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  {pctVivo(p)}% · {FRASES_PENSANDO[fraseIdx]}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ============ PASSO 1 — BIBLIOTECA ============ */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
            1
          </span>
          <h2 className="font-semibold text-slate-900">Escolha os modelos do corte</h2>
          <span className="ml-1 hidden text-xs text-slate-400 sm:inline">
            toque pra adicionar · 📎 anexa as curvas (PDF)
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastando(false);
              const f = e.dataTransfer.files?.[0];
              if (f) enviarArquivo(f);
            }}
            className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
              arrastando
                ? "border-brand-500 bg-brand-50"
                : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
            }`}
          >
            {enviando ? (
              <Loader2 className="size-7 animate-spin text-brand-600" />
            ) : (
              <UploadCloud className="size-7 text-brand-600" />
            )}
            <span className="text-sm font-medium text-slate-700">
              {enviando ? "Lendo o arquivo..." : "Novo modelo (.adsx / DXF)"}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".adsx,.dxf,.xml,.zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) enviarArquivo(f);
                e.target.value = "";
              }}
            />
          </button>

          {(modelos ?? []).map((m) => {
            const noCorte = carrinho.some((i) => i.detalhe.id === m.id);
            const temCurva = m.pieces.some((p) => p.temContorno);
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => adicionarAoCorte(m.id)}
                onKeyDown={(e) => e.key === "Enter" && adicionarAoCorte(m.id)}
                className={`group relative flex cursor-pointer flex-col rounded-2xl border p-3 text-left transition ${
                  noCorte
                    ? "border-brand-500 bg-brand-50/40 ring-4 ring-brand-500/15"
                    : "border-slate-200 bg-white hover:border-brand-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  {m.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.thumbnail}
                      alt=""
                      className="size-14 rounded-lg border border-slate-100 bg-slate-50 object-contain"
                    />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-lg bg-slate-100">
                      <Shirt className="size-6 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {m.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {m.pieces.length} peças · {m.sizes.join(" ")}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      {temCurva ? (
                        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          curva real
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            curvasPara.current = m.id;
                            curvasInput.current?.click();
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200"
                        >
                          <Paperclip className="size-2.5" />
                          {anexandoCurvas && curvasPara.current === m.id
                            ? "lendo..."
                            : "anexar curvas"}
                        </button>
                      )}
                      {noCorte && (
                        <span className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                          ✓ no corte
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {abrindoModelo === m.id && (
                  <Loader2 className="absolute right-2 top-2 size-4 animate-spin text-brand-600" />
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    excluirModelo(m.id);
                  }}
                  className="absolute right-2 bottom-2 rounded-lg p-1.5 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                  title="Excluir modelo"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>

        {modelos !== null && modelos.length === 0 && (
          <div className="mt-4">
            <EmptyState
              icon={<FileUp className="size-8" />}
              title="Nenhum modelo ainda"
              hint="Exporte o modelo no Audaces (Arquivo → Exportar) e solte o arquivo aqui — o sistema lê peças, grade e medidas sozinho."
            />
          </div>
        )}
        <input
          ref={curvasInput}
          type="file"
          accept=".pdf,.dxf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) anexarCurvas(f);
            e.target.value = "";
          }}
        />
      </Card>

      {/* ============ PASSO 2 — O CORTE ============ */}
      {carrinho.length > 0 && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              2
            </span>
            <h2 className="font-semibold text-slate-900">Monte o corte</h2>
            <span className="text-xs text-slate-400">
              {carrinho.length} modelo(s) · {totalPecasCarrinho} peça(s) de roupa · mesmo
              tecido e largura
            </span>
          </div>

          {/* itens do carrinho */}
          <div className="space-y-4">
            {carrinho.map((item, idx) => {
              const pecasTec = item.detalhe.pieces.filter((p) => p.pano === "TEC");
              const pecasFor = item.detalhe.pieces.filter((p) => p.pano === "FOR");
              return (
                <div key={item.detalhe.id} className="rounded-xl border border-slate-200 p-3.5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
                      <Shirt className="size-4 shrink-0 text-slate-400" />
                      <span className="truncate">{item.detalhe.name}</span>
                      <span className="shrink-0 text-xs font-normal text-slate-400">
                        {pecasTec.length} molde(s) no tecido
                        {pecasFor.length > 0 && ` + ${pecasFor.length} no forro`} ·{" "}
                        {item.detalhe.pieces.reduce((s, p) => s + p.qtd, 0)} peças por
                        roupa
                      </span>
                    </p>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setEditandoQtd(
                            editandoQtd === item.detalhe.id ? null : item.detalhe.id
                          )
                        }
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:border-brand-300 hover:text-brand-700"
                        title="Corrigir quantas vezes cada peça é cortada"
                      >
                        peças por roupa
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCarrinho((c) => c.filter((_, i) => i !== idx))
                        }
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                        title="Tirar do corte"
                      >
                        <X className="size-4" />
                      </button>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {item.detalhe.sizes.map((t) => (
                      <label key={t} className="block">
                        <span className="mb-1 block text-center text-xs font-semibold text-slate-500">
                          {t.trim()}
                        </span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          placeholder="0"
                          value={item.grade[t] ?? ""}
                          onChange={(e) =>
                            setCarrinho((c) =>
                              c.map((x, i) =>
                                i === idx
                                  ? { ...x, grade: { ...x.grade, [t]: e.target.value } }
                                  : x
                              )
                            )
                          }
                          className={`${inputCls} text-center font-semibold`}
                        />
                      </label>
                    ))}
                  </div>

                  {(() => {
                    // modelo importado ANTES do sistema entender peça em par:
                    // a manga ficou como 1 e o corte sairia sem metade delas
                    const suspeitas = item.detalhe.pieces.filter(
                      (p) =>
                        p.qtd < quantidadeSugerida(p.nome, p.desc) ||
                        // par com quantidade certa mas sem a marca de
                        // invertida: sairiam duas mangas do MESMO lado
                        (ehPecaPar(p.nome) && p.qtd >= 2 && !p.espelhada)
                    );
                    if (suspeitas.length === 0 || editandoQtd === item.detalhe.id)
                      return null;
                    return (
                      <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5">
                        <p className="text-xs text-amber-900">
                          ⚠️ <b>{suspeitas.map((p) => p.nome).join(", ")}</b>{" "}
                          {suspeitas.length === 1 ? "sai" : "saem"} em{" "}
                          <b>par (2 por roupa, uma invertida)</b>, mas o arquivo
                          trouxe {suspeitas.length === 1 ? "ela" : "elas"} como 1. Assim
                          o corte sai com metade das peças.
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            salvarQuantidades(
                              item.detalhe.id,
                              item.detalhe.pieces.map((p) => ({
                                nome: p.nome,
                                qtd: Math.max(p.qtd, quantidadeSugerida(p.nome, p.desc)),
                                // molde combinado (FRENTE E COSTAS) NÃO espelha:
                                // são duas partes diferentes do mesmo desenho
                                espelhada: p.espelhada || ehPecaPar(p.nome),
                              }))
                            )
                          }
                          className="mt-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
                        >
                          Corrigir pra 2 por roupa
                        </button>
                      </div>
                    );
                  })()}

                  {editandoQtd === item.detalhe.id && (
                    <EditorQuantidades
                      pecas={item.detalhe.pieces}
                      onSalvar={(pecas) => salvarQuantidades(item.detalhe.id, pecas)}
                      onFechar={() => setEditandoQtd(null)}
                    />
                  )}

                  {/* peças liga/desliga */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[...pecasTec, ...pecasFor].map((p) => {
                      // forro desligado no corte inteiro: a peça continua à
                      // vista (riscada), pra ninguém achar que ela sumiu
                      const forroOff = p.pano === "FOR" && !incluirForro;
                      const ligada = !forroOff && !item.pecasDesligadas.has(p.nome);
                      return (
                        <button
                          key={p.nome}
                          type="button"
                          onClick={() => {
                            if (forroOff) {
                              setIncluirForro(true); // religa o forro do corte
                              return;
                            }
                            setCarrinho((c) =>
                              c.map((x, i) => {
                                if (i !== idx) return x;
                                const n = new Set(x.pecasDesligadas);
                                if (n.has(p.nome)) n.delete(p.nome);
                                else n.add(p.nome);
                                return { ...x, pecasDesligadas: n };
                              })
                            );
                          }}
                          title={
                            forroOff
                              ? "O forro está desligado neste corte — clique pra ligar"
                              : ligada
                                ? "Clique pra tirar esta peça do corte"
                                : "Clique pra incluir esta peça de volta"
                          }
                          className={`rounded-lg border px-2 py-1 text-xs transition ${
                            ligada
                              ? "border-slate-200 bg-white text-slate-700"
                              : "border-slate-100 bg-slate-50 text-slate-400 line-through"
                          }`}
                        >
                          {p.nome}
                          {p.qtd > 1 && (
                            <b className="ml-1 text-brand-700">
                              ×{p.qtd}
                              {p.espelhada ? " ↔" : ""}
                            </b>
                          )}
                          {p.pano === "FOR" ? (forroOff ? " (forro desligado)" : " (forro)") : ""}
                        </button>
                      );
                    })}
                    {/* atalho no lugar onde o lojista está olhando: as peças */}
                    <button
                      type="button"
                      onClick={() =>
                        setEditandoQtd(
                          editandoQtd === item.detalhe.id ? null : item.detalhe.id
                        )
                      }
                      className="rounded-lg border border-dashed border-brand-300 px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
                      title="Manga, alça e bolso saem em par — ajuste aqui quantas vezes cada peça é cortada"
                    >
                      ✏️ quantas de cada peça
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* tecido, mesa e modo */}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Ruler className="size-4 text-slate-400" /> Tecido e mesa deste corte
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Largura do tecido (cm)">
                  <Input
                    value={larguraTecido}
                    onChange={(e) => setLarguraTecido(e.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Comprimento da mesa (cm)">
                  <Input value={mesa} onChange={(e) => setMesa(e.target.value)} inputMode="decimal" />
                </Field>
                {temForro && incluirForro && !forroMesmoTecido && (
                  <Field label="Largura do forro (cm)" hint="vazio = igual ao tecido">
                    <Input
                      value={larguraForro}
                      onChange={(e) => setLarguraForro(e.target.value)}
                      inputMode="decimal"
                      placeholder={larguraTecido}
                    />
                  </Field>
                )}
                <Field label="Folga entre peças (cm)">
                  <Input value={folga} onChange={(e) => setFolga(e.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Nome do corte (opcional)">
                  <Input
                    value={nomePlano}
                    onChange={(e) => setNomePlano(e.target.value)}
                    placeholder="Corte semana 32"
                  />
                </Field>
              </div>
              <div className="mt-3 space-y-2">
                {temForro && (
                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                    <span className="min-w-0 pr-3">
                      <span className="block text-sm font-medium text-slate-800">
                        Cortar o forro
                      </span>
                      <span className="block text-xs font-normal text-slate-400">
                        {forroMesmoTecido
                          ? "junto no mesmo risco do tecido"
                          : "risco separado, metragem própria"}
                      </span>
                    </span>
                    <Switch ligado={incluirForro} onChange={setIncluirForro} />
                  </label>
                )}
                {temForro && incluirForro && (
                  <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                    <span className="min-w-0 pr-3">
                      <span className="block text-sm font-medium text-slate-800">
                        O forro é o MESMO tecido
                      </span>
                      <span className="block text-xs font-normal text-slate-400">
                        corta tudo no mesmo risco — as peças de forro preenchem os
                        vãos e sai uma metragem só
                      </span>
                    </span>
                    <Switch ligado={forroMesmoTecido} onChange={setForroMesmoTecido} />
                  </label>
                )}
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="min-w-0 pr-3">
                    <span className="block text-sm font-medium text-slate-800">
                      Tecido com sentido (estampa direcional)
                    </span>
                    <span className="block text-xs text-slate-400">
                      veludo/estampa com pé — nenhuma peça sai de cabeça pra baixo
                    </span>
                  </span>
                  <Switch ligado={sentidoUnico} onChange={setSentidoUnico} />
                </label>
              </div>
            </div>

            {/* modo de otimização */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Brain className="size-4 text-slate-400" /> Quanto tempo o sistema pensa?
              </p>
              <div className="space-y-2">
                {MODOS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModo(m.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left transition ${
                      modo === m.id
                        ? "border-brand-500 bg-brand-50/50 ring-4 ring-brand-500/10"
                        : "border-slate-200 bg-white hover:border-brand-300"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        {m.label}{" "}
                        <span className="text-xs font-normal text-slate-400">{m.tempo}</span>
                      </span>
                      <span className="block text-xs text-slate-500">{m.desc}</span>
                    </span>
                    {modo === m.id && <CheckCircle2 className="size-5 text-brand-600" />}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                💡 O plano aparece em segundos e vai MELHORANDO enquanto o sistema pensa —
                dá pra parar e usar a qualquer momento.
              </p>

              <Button
                onClick={montarPlano}
                disabled={criando || totalPecasCarrinho === 0 || emAndamento.length >= 3}
                className="mt-4 w-full py-3 text-base"
              >
                {criando ? (
                  <>
                    <Loader2 className="size-5 animate-spin" /> Criando o plano...
                  </>
                ) : (
                  <>
                    <Brain className="size-5" /> Montar plano inteligente
                  </>
                )}
              </Button>
              {emAndamento.length >= 3 && (
                <p className="mt-2 text-xs text-amber-600">
                  3 planos já estão calculando — espere um terminar (ou pare um) pra
                  começar outro.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ============ PASSO 3 — PLANO (ao vivo ou concluído) ============ */}
      {detalhe && (
        <div ref={resultadoRef} className="scroll-mt-4 space-y-4">
          <Card className="p-5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`flex size-7 items-center justify-center rounded-full text-sm font-bold text-white ${
                    detalhe.status === "EM_ANDAMENTO" ? "bg-brand-600" : "bg-emerald-600"
                  }`}
                >
                  3
                </span>
                <h2 className="font-semibold text-slate-900">
                  {detalhe.nome || detalhe.modelName || "Plano de corte"}
                  {detalhe.status === "EM_ANDAMENTO" ? " — melhorando ao vivo" : " — pronto"}
                </h2>
              </div>
              {detalhe.status === "EM_ANDAMENTO" && (
                <button
                  type="button"
                  onClick={() => pararPlano(detalhe.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  <Square className="size-3.5" /> Parar e usar esse
                </button>
              )}
            </div>

            {detalhe.status === "EM_ANDAMENTO" ? (
              <>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-1000"
                    style={{ width: `${pctVivo(detalhe)}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
                  <span className="font-medium">
                    {pctVivo(detalhe)}% · ⏱️ {fmtTempo(tempoVivo(detalhe))} /{" "}
                    {fmtTempo(detalhe.budgetMs)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {detalhe.tentativas.toLocaleString("pt-BR")} encaixes testados
                    {detalhe.aproveitamento ? ` · melhor até agora: ${detalhe.aproveitamento}%` : ""}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{FRASES_PENSANDO[fraseIdx]}</p>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <Sparkles className="size-4 text-amber-500" />
                {detalhe.tentativas.toLocaleString("pt-BR")} encaixes testados em{" "}
                {fmtTempo(detalhe.elapsedMs)} pra{" "}
                {detalhe.resultado?.totalPecasRoupa ?? 0} peça(s) de roupa — este é o
                melhor plano que encontrei.
              </p>
            )}
          </Card>

          {detalhe.resultado?.planos.map((plano) => (
            <Card key={plano.pano} className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">
                  {PANO_LABEL[plano.pano] ?? plano.pano}
                </h3>
                <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                  estratégia: {plano.estrategiaEnfesto}
                </span>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-3">
                <Metrica
                  valor={fmtM(plano.totalTecidoCm)}
                  rotulo={`de ${PANO_LABEL[plano.pano]?.toLowerCase() ?? "pano"} no total`}
                />
                <Metrica
                  valor={`${plano.aproveitamentoMedio.toFixed(1)}%`}
                  rotulo="aproveitamento"
                />
                <Metrica
                  valor={String(plano.riscos.length)}
                  rotulo={plano.riscos.length === 1 ? "corte na mesa" : "cortes na mesa"}
                />
              </div>

              {plano.comparativo.length > 1 && (
                <div className="mb-4 rounded-xl bg-slate-50 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <TrendingDown className="size-3.5" /> Estratégias de enfesto analisadas:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {plano.comparativo.map((c, i) => (
                      <span
                        key={c.estrategia}
                        className={`rounded-lg px-2 py-1 text-xs ${
                          i === 0
                            ? "bg-emerald-100 font-semibold text-emerald-800"
                            : "border border-slate-200 bg-white text-slate-500"
                        }`}
                      >
                        {i === 0 && <CheckCircle2 className="mr-1 inline size-3.5" />}
                        {c.estrategia}: {fmtM(c.totalTecidoCm)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {plano.avisos.map((a) => (
                <div
                  key={a}
                  className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
                  ⚠️ {a}
                </div>
              ))}

              <div className="space-y-4">
                {plano.riscos.map((r, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        ✂️ Corte {idx + 1} — risco de {(r.comprimentoCm / 100).toFixed(2)}m ×{" "}
                        {r.folhas} folhas
                        {r.enfestos > 1 ? ` (em ${r.enfestos} enfestos)` : ""}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          consome ~
                          {(
                            (r.folhas *
                              (r.comprimentoCm + (detalhe.params?.perdaPorFolhaCm ?? 3))) /
                            100
                          ).toFixed(1)}
                          m · {r.aproveitamento.toFixed(1)}%
                        </span>
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          {r.rotulo ??
                            Object.entries(r.combo)
                              .map(([t, v]) => (v > 1 ? `${v}× ${t.trim()}` : t.trim()))
                              .join(" + ")}
                        </span>
                      </p>
                      <a
                        href={`/api/plano-corte/planos/${detalhe.id}/plt?pano=${plano.pano}&risco=${idx}`}
                        download
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
                      >
                        <Download className="size-3.5" /> PLT pra plotter
                      </a>
                    </div>
                    <div
                      className="overflow-x-auto rounded-lg [&_svg]:h-auto [&_svg]:w-full [&_svg]:min-w-[640px]"
                      dangerouslySetInnerHTML={{ __html: r.svg }}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ============ HISTÓRICO ============ */}
      {historico.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Últimos planos</h3>
          <div className="divide-y divide-slate-100">
            {historico.slice(0, 10).map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => abrirPlano(h.id)}
                  className="min-w-0 text-left"
                >
                  <p className="truncate text-sm font-medium text-slate-800 hover:text-brand-700">
                    {h.nome || h.modelName || "Plano de corte"}
                    {(h.modelos ?? 1) > 1 && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        {h.modelos} modelos
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(h.criadoEm).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    · {h.totalPecasRoupa ?? 0} peças
                    {h.aproveitamento ? ` · ${h.aproveitamento}%` : ""}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <div className="flex gap-2 text-xs text-slate-600">
                    {h.panos.map((p) => (
                      <span key={p.pano} className="rounded-lg bg-slate-100 px-2 py-1">
                        {PANO_LABEL[p.pano] ?? p.pano}:{" "}
                        {p.totalM.toLocaleString("pt-BR")} m
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => excluirPlano(h.id)}
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {carrinho.length === 0 && modelos !== null && modelos.length > 0 && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 p-6 text-sm text-slate-400">
          <Plus className="size-4" /> Toque num modelo lá em cima pra começar um corte
          <Scissors className="size-4" />
        </div>
      )}
    </div>
  );
}

/* ---------- peças de UI locais ---------- */

/**
 * Editor de "peças por roupa": manga e alça saem em PAR (2 do mesmo molde),
 * e nem todo arquivo do Audaces declara isso de forma legível. Aqui o
 * lojista acerta uma vez e fica valendo pro modelo inteiro.
 */
function EditorQuantidades({
  pecas,
  onSalvar,
  onFechar,
}: {
  pecas: ModeloDetalhe["pieces"];
  onSalvar: (pecas: { nome: string; qtd: number; espelhada?: boolean }[]) => void;
  onFechar: () => void;
}) {
  const [qtds, setQtds] = useState<Record<string, number>>(() =>
    Object.fromEntries(pecas.map((p) => [p.nome, p.qtd]))
  );
  // quais saem em PAR (a 2ª invertida): começa no que o arquivo/nome dizem
  const [pares, setPares] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(pecas.map((p) => [p.nome, Boolean(p.espelhada) || ehPecaPar(p.nome)]))
  );
  const [salvando, setSalvando] = useState(false);

  return (
    <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-700">
        Quantas vezes cada peça é cortada por roupa
      </p>
      <div className="space-y-1.5">
        {pecas.map((p) => (
          <div key={p.nome} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-slate-600">
              {p.nome}
              {p.pano === "FOR" && <span className="text-slate-400"> (forro)</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {/* atalho de par: 2 peças, a segunda invertida */}
              <button
                type="button"
                onClick={() => {
                  const virar = !pares[p.nome];
                  setPares((v) => ({ ...v, [p.nome]: virar }));
                  setQtds((q) => ({
                    ...q,
                    [p.nome]: virar ? Math.max(2, q[p.nome] ?? 1) : 1,
                  }));
                }}
                className={`rounded-lg border px-1.5 py-0.5 text-[11px] font-medium transition ${
                  pares[p.nome]
                    ? "border-brand-300 bg-brand-100 text-brand-800"
                    : "border-slate-200 bg-white text-slate-400"
                }`}
                title="Sai em par: 2 peças, a segunda invertida (manga, alça, bolso)"
              >
                ↔ par
              </button>
              <button
                type="button"
                onClick={() =>
                  setQtds((q) => ({ ...q, [p.nome]: Math.max(1, (q[p.nome] ?? 1) - 1) }))
                }
                className="size-6 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-500 transition hover:border-brand-300"
              >
                −
              </button>
              <span className="w-7 text-center text-sm font-semibold tabular-nums text-slate-800">
                {qtds[p.nome] ?? 1}
              </span>
              <button
                type="button"
                onClick={() =>
                  setQtds((q) => ({ ...q, [p.nome]: Math.min(50, (q[p.nome] ?? 1) + 1) }))
                }
                className="size-6 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-500 transition hover:border-brand-300"
              >
                +
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        💡 <b>↔ par</b> = a peça sai 2 vezes, a segunda invertida (manga, alça,
        bolso). Use o <b>+</b> quando o mesmo molde serve mais partes da roupa
        sem inverter (ex.: frente e costas no mesmo desenho).
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            setSalvando(true);
            await onSalvar(
              pecas.map((p) => ({
                nome: p.nome,
                qtd: qtds[p.nome] ?? 1,
                espelhada: Boolean(pares[p.nome]),
              }))
            );
            setSalvando(false);
          }}
          disabled={salvando}
          className="flex-1 rounded-xl bg-brand-600 py-2 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Salvar no modelo"}
        </button>
        <button
          type="button"
          onClick={onFechar}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 transition"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Switch({ ligado, onChange }: { ligado: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onChange(!ligado)}
      className={`relative h-6 w-11 rounded-full transition ${
        ligado ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          ligado ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Metrica({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <p className="text-xl font-bold text-slate-900 sm:text-2xl">{valor}</p>
      <p className="text-xs text-slate-500">{rotulo}</p>
    </div>
  );
}
