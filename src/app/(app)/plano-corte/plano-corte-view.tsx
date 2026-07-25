"use client";

/**
 * Plano de Corte Inteligente — fluxo em 3 passos na mesma tela:
 *   1. Modelo: upload do arquivo do CAD (.adsx/.dxf) e escolha do modelo
 *   2. Configuração: peças (liga/desliga forro), grade, tecido e mesa
 *   3. Resultado: riscos desenhados, metragens, estratégia vencedora e PLT
 *
 * UX pensada pra quem está do lado da mesa de corte: números grandes,
 * linguagem de confecção (folhas, enfesto, risco) e zero jargão técnico.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  Download,
  FileUp,
  Loader2,
  Ruler,
  Scissors,
  Shirt,
  Sparkles,
  Trash2,
  TrendingDown,
  UploadCloud,
} from "lucide-react";
import { Button, Card, EmptyState, Field, Input, inputCls } from "@/components/ui";

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
  source: string;
  thumbnail: string | null;
  sizes: string[];
  pieces: {
    nome: string;
    pano: "TEC" | "FOR";
    qtd: number;
    desc?: string;
    tamanhos: Record<string, { w: number; h: number; area: number; contorno?: unknown }>;
  }[];
};

type RiscoResp = {
  combo: Record<string, number>;
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

type ResultadoResp = {
  id: string;
  modelName: string;
  resultado: {
    planos: PlanoResp[];
    totalPecasRoupa: number;
    analises: number;
  };
};

type HistoricoItem = {
  id: string;
  modelName: string;
  createdAt: string;
  totalPecasRoupa: number;
  panos: { pano: string; totalM: number; riscos: number }[];
};

/* ---------- helpers ---------- */

const fmtM = (cm: number) => `${(cm / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m`;

async function arquivoParaBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK)
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

const PANO_LABEL: Record<string, string> = { TEC: "Tecido", FOR: "Forro" };

/* ---------- componente principal ---------- */

export function PlanoCorteView() {
  const [modelos, setModelos] = useState<ModeloResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const [selecionado, setSelecionado] = useState<ModeloDetalhe | null>(null);
  const [carregandoModelo, setCarregandoModelo] = useState(false);

  // configuração do plano
  const [grade, setGrade] = useState<Record<string, string>>({});
  const [pecasDesligadas, setPecasDesligadas] = useState<Set<string>>(new Set());
  const [incluirForro, setIncluirForro] = useState(true);
  const [larguraTecido, setLarguraTecido] = useState("160");
  const [larguraForro, setLarguraForro] = useState("");
  const [mesa, setMesa] = useState("600");
  const [folga, setFolga] = useState("0,5");
  const [maxFolhas, setMaxFolhas] = useState("60");
  const [sentidoUnico, setSentidoUnico] = useState(false);

  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoResp | null>(null);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);
  const [anexandoCurvas, setAnexandoCurvas] = useState(false);
  const [msgCurvas, setMsgCurvas] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const curvasInput = useRef<HTMLInputElement>(null);
  const resultadoRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const [rm, rh] = await Promise.all([
        fetch("/api/plano-corte/modelos"),
        fetch("/api/plano-corte/gerar"),
      ]);
      if (rm.ok) setModelos(await rm.json());
      else setErro((await rm.json()).error ?? "Erro ao carregar modelos");
      if (rh.ok) setHistorico(await rh.json());
    } catch {
      setErro("Sem conexão — tente de novo");
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /* ---------- upload ---------- */

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
        await carregar();
        abrirModelo(data.id);
      } catch {
        setErro("Falha no envio — tente de novo");
      } finally {
        setEnviando(false);
      }
    },
    [carregar] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ---------- seleção de modelo ---------- */

  async function abrirModelo(id: string) {
    setCarregandoModelo(true);
    setResultado(null);
    setErro(null);
    try {
      const r = await fetch(`/api/plano-corte/modelos/${id}`);
      if (!r.ok) {
        setErro("Modelo não encontrado");
        return;
      }
      const det: ModeloDetalhe = await r.json();
      setSelecionado(det);
      setGrade(Object.fromEntries(det.sizes.map((s) => [s, ""])));
      setPecasDesligadas(new Set());
      setIncluirForro(true);
    } finally {
      setCarregandoModelo(false);
    }
  }

  /** Anexa o PDF/DXF com as curvas reais ao modelo aberto (casamento por medidas). */
  async function anexarCurvas(file: File) {
    if (!selecionado) return;
    setMsgCurvas(null);
    setErro(null);
    setAnexandoCurvas(true);
    try {
      const contentBase64 = await arquivoParaBase64(file);
      const r = await fetch(`/api/plano-corte/modelos/${selecionado.id}/curvas`, {
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
      await abrirModelo(selecionado.id); // recarrega com o selo "curva real"
      await carregar();
    } catch {
      setErro("Falha no envio — tente de novo");
    } finally {
      setAnexandoCurvas(false);
    }
  }

  async function excluirModelo(id: string) {
    if (!confirm("Excluir este modelo e seus planos salvos?")) return;
    await fetch(`/api/plano-corte/modelos/${id}`, { method: "DELETE" });
    if (selecionado?.id === id) setSelecionado(null);
    await carregar();
  }

  /* ---------- gerar plano ---------- */

  const num = (s: string, padrao: number) => {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : padrao;
  };

  async function gerar() {
    if (!selecionado) return;
    const gradeNum: Record<string, number> = {};
    for (const [t, v] of Object.entries(grade)) {
      const n = parseInt(v, 10);
      if (n > 0) gradeNum[t] = n;
    }
    if (Object.keys(gradeNum).length === 0) {
      setErro("Informe a quantidade de pelo menos um tamanho");
      return;
    }
    setErro(null);
    setGerando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/plano-corte/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selecionado.id,
          grade: gradeNum,
          larguraTecidoCm: num(larguraTecido, 160),
          larguraForroCm: larguraForro.trim() ? num(larguraForro, 160) : undefined,
          mesaCm: num(mesa, 600),
          folgaCm: num(folga, 0.5),
          maxFolhas: Math.round(num(maxFolhas, 60)),
          incluirForro,
          pecasDesligadas: [...pecasDesligadas],
          sentidoUnico,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErro(data.error ?? "Não consegui montar o plano");
        return;
      }
      setResultado(data);
      await carregar();
      setTimeout(() => resultadoRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch {
      setErro("Falha ao gerar o plano — tente de novo");
    } finally {
      setGerando(false);
    }
  }

  /* ---------- render ---------- */

  const pecasTec = selecionado?.pieces.filter((p) => p.pano === "TEC") ?? [];
  const pecasFor = selecionado?.pieces.filter((p) => p.pano === "FOR") ?? [];
  const totalPecasLigadas =
    pecasTec.filter((p) => !pecasDesligadas.has(p.nome)).length +
    (incluirForro ? pecasFor.filter((p) => !pecasDesligadas.has(p.nome)).length : 0);

  return (
    <div className="space-y-6">
      {erro && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erro}
        </div>
      )}

      {/* ============ PASSO 1 — MODELOS ============ */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-white text-sm font-bold">1</span>
          <h2 className="font-semibold text-slate-900">Escolha o modelo</h2>
          <span className="text-xs text-slate-400 ml-1 hidden sm:inline">arquivos .adsx (Audaces) ou .dxf</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* dropzone */}
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
            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition min-h-36 ${
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
              {enviando ? "Lendo o arquivo..." : "Solte o arquivo aqui"}
            </span>
            <span className="text-xs text-slate-400">ou toque pra escolher</span>
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

          {/* cards de modelo */}
          {(modelos ?? []).map((m) => {
            const ativo = selecionado?.id === m.id;
            const temCurva = m.pieces.some((p) => p.temContorno);
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => abrirModelo(m.id)}
                onKeyDown={(e) => e.key === "Enter" && abrirModelo(m.id)}
                className={`group relative flex flex-col rounded-2xl border p-3 text-left transition cursor-pointer ${
                  ativo
                    ? "border-brand-500 ring-4 ring-brand-500/15 bg-brand-50/40"
                    : "border-slate-200 hover:border-brand-300 bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  {m.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.thumbnail}
                      alt=""
                      className="size-14 rounded-lg object-contain bg-slate-50 border border-slate-100"
                    />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-lg bg-slate-100">
                      <Shirt className="size-6 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">
                      {m.pieces.length} peças · {m.sizes.join(" ")}
                    </p>
                    <div className="mt-1 flex gap-1">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {m.source}
                      </span>
                      {temCurva && (
                        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                          curva real
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    excluirModelo(m.id);
                  }}
                  className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
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
              hint="Exporte o modelo no Audaces Moldes (Arquivo → Exportar) e solte o arquivo aqui — o sistema lê peças, grade e medidas sozinho."
            />
          </div>
        )}
      </Card>

      {/* ============ PASSO 2 — CONFIGURAÇÃO ============ */}
      {carregandoModelo && (
        <Card className="flex items-center justify-center gap-2 p-8 text-slate-500">
          <Loader2 className="size-5 animate-spin" /> Abrindo o modelo...
        </Card>
      )}

      {selecionado && !carregandoModelo && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-white text-sm font-bold">2</span>
            <h2 className="font-semibold text-slate-900">Monte o corte</h2>
            <ChevronRight className="size-4 text-slate-300" />
            <span className="truncate text-sm text-slate-500">{selecionado.name}</span>
            {(() => {
              const temCurva = selecionado.pieces.some((p) =>
                Object.values(p.tamanhos).some((t) => !!t.contorno)
              );
              return temCurva ? (
                <span className="ml-auto rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  ✓ curva real — encaixe profissional
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => curvasInput.current?.click()}
                  disabled={anexandoCurvas}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
                >
                  {anexandoCurvas ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FileUp className="size-3.5" />
                  )}
                  Anexar curvas (PDF do Audaces)
                </button>
              );
            })()}
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
          </div>
          {msgCurvas && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {msgCurvas}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* peças */}
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <Scissors className="size-4 text-slate-400" /> Peças do molde
              </p>
              <div className="space-y-2">
                {pecasTec.map((p) => (
                  <TogglePeca
                    key={p.nome}
                    nome={p.nome}
                    detalhe={p.desc ?? "tecido"}
                    ligada={!pecasDesligadas.has(p.nome)}
                    onToggle={() =>
                      setPecasDesligadas((s) => {
                        const n = new Set(s);
                        if (n.has(p.nome)) n.delete(p.nome);
                        else n.add(p.nome);
                        return n;
                      })
                    }
                  />
                ))}
              </div>

              {pecasFor.length > 0 && (
                <div className="mt-4 rounded-xl border border-slate-200 p-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-medium text-slate-700">
                      Forro
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {pecasFor.length} peça(s) — risco separado
                      </span>
                    </span>
                    <Switch ligado={incluirForro} onChange={setIncluirForro} />
                  </label>
                  {incluirForro && (
                    <div className="mt-2 space-y-2">
                      {pecasFor.map((p) => (
                        <TogglePeca
                          key={p.nome}
                          nome={p.nome}
                          detalhe={p.desc ?? "forro"}
                          ligada={!pecasDesligadas.has(p.nome)}
                          onToggle={() =>
                            setPecasDesligadas((s) => {
                              const n = new Set(s);
                              if (n.has(p.nome)) n.delete(p.nome);
                              else n.add(p.nome);
                              return n;
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* grade + tecido/mesa */}
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Shirt className="size-4 text-slate-400" /> Quantas peças de cada tamanho?
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {selecionado.sizes.map((t) => (
                    <label key={t} className="block">
                      <span className="mb-1 block text-center text-xs font-semibold text-slate-500">
                        {t}
                      </span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="0"
                        value={grade[t] ?? ""}
                        onChange={(e) => setGrade((g) => ({ ...g, [t]: e.target.value }))}
                        className={`${inputCls} text-center text-lg font-semibold`}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Ruler className="size-4 text-slate-400" /> Tecido e mesa
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Largura do tecido (cm)">
                    <Input value={larguraTecido} onChange={(e) => setLarguraTecido(e.target.value)} inputMode="decimal" />
                  </Field>
                  <Field label="Comprimento da mesa (cm)">
                    <Input value={mesa} onChange={(e) => setMesa(e.target.value)} inputMode="decimal" />
                  </Field>
                  {incluirForro && pecasFor.length > 0 && (
                    <Field label="Largura do forro (cm)" hint="vazio = igual ao tecido">
                      <Input value={larguraForro} onChange={(e) => setLarguraForro(e.target.value)} inputMode="decimal" placeholder={larguraTecido} />
                    </Field>
                  )}
                  <Field label="Folga entre peças (cm)">
                    <Input value={folga} onChange={(e) => setFolga(e.target.value)} inputMode="decimal" />
                  </Field>
                  <Field label="Folhas máx. por enfesto">
                    <Input value={maxFolhas} onChange={(e) => setMaxFolhas(e.target.value)} inputMode="numeric" />
                  </Field>
                </div>
                <label className="mt-3 flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
                  <span className="min-w-0 pr-3">
                    <span className="block text-sm font-medium text-slate-800">
                      Tecido com sentido (estampa direcional)
                    </span>
                    <span className="block text-xs text-slate-400">
                      liga pra veludo/estampa com direção — nenhuma peça sai de cabeça pra baixo
                    </span>
                  </span>
                  <Switch ligado={sentidoUnico} onChange={setSentidoUnico} />
                </label>
              </div>

              <Button
                onClick={gerar}
                disabled={gerando || totalPecasLigadas === 0}
                className="w-full py-3 text-base"
              >
                {gerando ? (
                  <>
                    <Loader2 className="size-5 animate-spin" /> Analisando combinações...
                  </>
                ) : (
                  <>
                    <Brain className="size-5" /> Montar plano inteligente
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ============ PASSO 3 — RESULTADO ============ */}
      {resultado && (
        <div ref={resultadoRef} className="space-y-4 scroll-mt-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-sm font-bold">3</span>
              <h2 className="font-semibold text-slate-900">Plano pronto</h2>
            </div>
            <p className="flex items-center gap-1.5 text-sm text-slate-500">
              <Sparkles className="size-4 text-amber-500" />
              Testei {resultado.resultado.analises} combinações de encaixe pra{" "}
              {resultado.resultado.totalPecasRoupa} peça(s) de roupa — este é o plano que gasta menos tecido.
            </p>
          </Card>

          {resultado.resultado.planos.map((plano) => (
            <Card key={plano.pano} className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">
                  {PANO_LABEL[plano.pano] ?? plano.pano}
                </h3>
                <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                  estratégia: {plano.estrategiaEnfesto}
                </span>
              </div>

              {/* números grandes */}
              <div className="mb-4 grid grid-cols-3 gap-3">
                <Metrica valor={fmtM(plano.totalTecidoCm)} rotulo={`de ${PANO_LABEL[plano.pano]?.toLowerCase() ?? "pano"} no total`} />
                <Metrica valor={`${plano.aproveitamentoMedio.toFixed(0)}%`} rotulo="aproveitamento" />
                <Metrica valor={String(plano.riscos.length)} rotulo={plano.riscos.length === 1 ? "risco" : "riscos"} />
              </div>

              {/* comparativo de estratégias */}
              {plano.comparativo.length > 1 && (
                <div className="mb-4 rounded-xl bg-slate-50 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <TrendingDown className="size-3.5" /> Outras formas que analisei (metragem total):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {plano.comparativo.map((c, i) => (
                      <span
                        key={c.estrategia}
                        className={`rounded-lg px-2 py-1 text-xs ${
                          i === 0
                            ? "bg-emerald-100 font-semibold text-emerald-800"
                            : "bg-white text-slate-500 border border-slate-200"
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
                <div key={a} className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠️ {a}
                </div>
              ))}

              {/* riscos */}
              <div className="space-y-4">
                {plano.riscos.map((r, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        Risco {idx + 1}:{" "}
                        {Object.entries(r.combo)
                          .map(([t, v]) => (v > 1 ? `${v}× ${t.trim()}` : t.trim()))
                          .join(" + ")}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          {(r.comprimentoCm / 100).toFixed(2)}m · {r.folhas} folhas
                          {r.enfestos > 1 ? ` em ${r.enfestos} enfestos` : ""} · {r.aproveitamento.toFixed(0)}%
                        </span>
                      </p>
                      <a
                        href={`/api/plano-corte/planos/${resultado.id}/plt?pano=${plano.pano}&risco=${idx}`}
                        download
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
                      >
                        <Download className="size-3.5" /> PLT pra plotter
                      </a>
                    </div>
                    <div
                      className="overflow-x-auto rounded-lg [&_svg]:h-auto [&_svg]:min-w-[640px] [&_svg]:w-full"
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
            {historico.slice(0, 8).map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{h.modelName}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(h.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{" "}
                    · {h.totalPecasRoupa} peças
                  </p>
                </div>
                <div className="flex gap-2 text-xs text-slate-600">
                  {h.panos.map((p) => (
                    <span key={p.pano} className="rounded-lg bg-slate-100 px-2 py-1">
                      {PANO_LABEL[p.pano] ?? p.pano}: {p.totalM.toLocaleString("pt-BR")} m · {p.riscos} risco(s)
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- peças de UI locais ---------- */

function Switch({ ligado, onChange }: { ligado: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onChange(!ligado)}
      className={`relative h-6 w-11 rounded-full transition ${ligado ? "bg-brand-600" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          ligado ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function TogglePeca({
  nome,
  detalhe,
  ligada,
  onToggle,
}: {
  nome: string;
  detalhe: string;
  ligada: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 transition ${
        ligada ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-800">{nome}</span>
        <span className="block text-xs text-slate-400">{detalhe.trim()}</span>
      </span>
      <Switch ligado={ligada} onChange={onToggle} />
    </label>
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
