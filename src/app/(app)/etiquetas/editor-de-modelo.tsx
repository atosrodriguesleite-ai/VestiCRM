"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Barcode, Copy, ImagePlus, Loader2, Type, X } from "lucide-react";
import { Portal } from "@/components/portal";
import {
  ALTURA_MAX_MM,
  ALTURA_MIN_MM,
  CAMPOS,
  COLUNAS_MAX,
  DADOS_DE_EXEMPLO,
  ESPACO_MAX_MM,
  LARGURA_LINHA_MAX_MM,
  LARGURA_MAX_MM,
  LARGURA_MIN_MM,
  areaDeDesenho,
  OPCOES_PADRAO,
  elementosCabem,
  larguraDaLinha,
  layoutPorTipo,
  type Elemento,
  type OpcoesEmbalagem,
  type ElementoTexto,
  type Modelo,
  type TipoDeEtiqueta,
} from "@/lib/etiquetas/modelo";
import { svgDaLinha, svgDoDesenho } from "@/lib/etiquetas/svg";
import { bitmapDaImagem, imagemParaModelo } from "@/lib/etiquetas/rasterizar";

type Aberto = {
  id: string;
  nome: string;
  tipo: TipoDeEtiqueta;
  larguraMm: number;
  alturaMm: number;
  colunas: number;
  espacoMm: number;
  girada: boolean;
  /** desenho próprio (true) ou por regra (false) */
  editado: boolean;
  modelo: Modelo;
};

const arred = (v: number) => Math.round(v * 2) / 2; // meio milímetro

/**
 * O EDITOR DE MODELO (RN-059): tamanho do rolo, elementos (texto fixo, campo
 * da peça, código de barras, imagem), arraste e redimensionamento na prévia,
 * ordem e propriedades. A prévia de edição é a ÁREA DE DESENHO (deitada
 * quando a etiqueta é girada); embaixo, "como sai no rolo" mostra a linha
 * inteira, girada e com as colunas — a mesma função que imprime.
 */
export function EditorDeModelo({ modeloId, podeEditar, onClose }: { modeloId: string; podeEditar: boolean; onClose: () => void }) {
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [nome, setNome] = useState("");
  const [tam, setTam] = useState({ larguraMm: 50, alturaMm: 30, colunas: 1, espacoMm: 2, girada: false });
  const [elementos, setElementos] = useState<Elemento[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [sujo, setSujo] = useState(false);
  // o desenho é do editor (elementos mexidos) ou por regra (reflui quando o
  // tamanho muda e NÃO viaja no salvamento — salvar só o nome não congela um
  // "desenho automático" em "desenho próprio"; achado da revisão)
  const [editado, setEditado] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesEmbalagem>(OPCOES_PADRAO);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/etiquetas/modelos/${modeloId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: (Aberto & { opcoes: OpcoesEmbalagem }) | null) => {
        if (!d) return;
        setAberto(d);
        setNome(d.nome);
        setTam({ larguraMm: d.larguraMm, alturaMm: d.alturaMm, colunas: d.colunas, espacoMm: d.espacoMm, girada: d.girada });
        setElementos(d.modelo.elementos);
        setEditado(d.editado);
        setOpcoes(d.opcoes);
      });
  }, [modeloId]);

  // modelo por regra: mudar tamanho/colunas/giro refaz o desenho por regra
  const mudarTam = (patch: Partial<typeof tam>) => {
    const novo = { ...tam, ...patch };
    setTam(novo);
    setSujo(true);
    if (!editado && aberto) {
      setElementos(layoutPorTipo(aberto.tipo, { ...opcoes, ...novo, girar: novo.girada ? "sim" : "nao" }).elementos);
    }
  };
  const voltarAoAutomatico = () => {
    if (!aberto) return;
    setElementos(layoutPorTipo(aberto.tipo, { ...opcoes, ...tam, girar: tam.girada ? "sim" : "nao" }).elementos);
    setEditado(false);
    setSel(null);
    setSujo(true);
  };

  const modelo: Modelo = useMemo(() => ({ ...tam, elementos }), [tam, elementos]);
  const area = areaDeDesenho(modelo);
  const cabe = useMemo(() => elementosCabem(modelo), [modelo]);
  const svgDesenho = useMemo(() => svgDoDesenho(modelo, DADOS_DE_EXEMPLO), [modelo]);
  const svgRolo = useMemo(
    () => svgDaLinha(modelo, Array.from({ length: modelo.colunas }, () => DADOS_DE_EXEMPLO)),
    [modelo]
  );
  // escala da prévia de edição: cabe em ~560 px, mínimo 3 px/mm
  const escala = Math.max(3, Math.min(8, 560 / area.w));

  const mudar = (fn: (els: Elemento[]) => Elemento[]) => {
    setElementos(fn);
    setSujo(true);
    setEditado(true);
  };
  const mudarSel = (patch: Partial<Elemento>) => {
    if (sel === null) return;
    mudar((els) => els.map((e, i) => (i === sel ? ({ ...e, ...patch } as Elemento) : e)));
  };

  // ARRASTE: pointer events na caixa do elemento; move em meio milímetro
  const arraste = useRef<{ i: number; x0: number; y0: number; ex: number; ey: number; modo: "mover" | "redimensionar"; ew: number; eh: number } | null>(null);
  const onPointerDown = (i: number, modo: "mover" | "redimensionar") => (e: React.PointerEvent) => {
    if (!podeEditar) return;
    e.preventDefault();
    e.stopPropagation();
    setSel(i);
    const el = elementos[i];
    arraste.current = { i, x0: e.clientX, y0: e.clientY, ex: el.x, ey: el.y, ew: el.w, eh: el.h, modo };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const a = arraste.current;
      if (!a) return;
      const dx = (e.clientX - a.x0) / escala;
      const dy = (e.clientY - a.y0) / escala;
      setElementos((els) =>
        els.map((el, i) => {
          if (i !== a.i) return el;
          if (a.modo === "mover") {
            return { ...el, x: Math.max(0, arred(a.ex + dx)), y: Math.max(0, arred(a.ey + dy)) };
          }
          return { ...el, w: Math.max(2, arred(a.ew + dx)), h: Math.max(1, arred(a.eh + dy)) };
        })
      );
      setSujo(true);
      setEditado(true);
    },
    [escala]
  );
  const onPointerUp = () => {
    arraste.current = null;
  };

  function adicionar(el: Elemento) {
    mudar((els) => [...els, el]);
    setSel(elementos.length);
  }
  const novoTexto = (campo: ElementoTexto["campo"]) =>
    adicionar({ tipo: "texto", campo, ...(campo === "texto" ? { texto: "Texto" } : {}), x: 2, y: 2, w: Math.max(10, area.w - 4), h: 3.4, pt: 8 });

  async function escolherImagem(file: File) {
    try {
      const src = await imagemParaModelo(file);
      const lado = Math.min(15, area.w - 4, area.h - 4);
      adicionar({ tipo: "imagem", x: 2, y: 2, w: lado, h: lado, src });
    } catch {
      setMsg({ tipo: "erro", texto: "Não deu para ler essa imagem. Use PNG ou JPG." });
    }
  }

  async function salvar() {
    if (!aberto) return;
    setBusy(true);
    setMsg(null);
    try {
      // as imagens viram bitmap preto e branco no tamanho em que estão (Zebra),
      // já na orientação física quando a etiqueta é girada
      let elementosParaEnviar: Elemento[] | null | undefined = undefined;
      if (editado) {
        const prontos: Elemento[] = [];
        for (const el of elementos) {
          if (el.tipo === "imagem") prontos.push({ ...el, bitmap: await bitmapDaImagem(el.src, el.w, el.h, tam.girada) });
          else prontos.push(el);
        }
        elementosParaEnviar = prontos;
      } else if (aberto.editado) {
        // era desenho próprio e a lojista voltou ao automático
        elementosParaEnviar = null;
      }
      const r = await fetch(`/api/etiquetas/modelos/${aberto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim() || aberto.nome, ...tam, ...(elementosParaEnviar !== undefined ? { elementos: elementosParaEnviar } : {}) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg({ tipo: "erro", texto: d?.error ?? "Não foi possível salvar." });
        return;
      }
      setSujo(false);
      setAberto({ ...aberto, editado });
      setMsg({ tipo: "ok", texto: "Modelo salvo. As próximas impressões saem assim." });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : "Erro ao salvar." });
    } finally {
      setBusy(false);
    }
  }

  const campo = "w-full rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-brand-400 disabled:bg-gray-50";
  const numero = (chave: "x" | "y" | "w" | "h") => (
    <label className="text-[11px] text-gray-500">
      {chave === "x" ? "Esq." : chave === "y" ? "Topo" : chave === "w" ? "Larg." : "Alt."} (mm)
      <input
        type="number"
        step={0.5}
        min={0}
        value={sel !== null ? elementos[sel][chave] : 0}
        disabled={!podeEditar || sel === null}
        onChange={(e) => mudarSel({ [chave]: Math.max(0, Number(e.target.value) || 0) } as Partial<Elemento>)}
        className={campo}
      />
    </label>
  );
  const elSel = sel !== null ? elementos[sel] : null;
  const camposDoTipo = CAMPOS.filter((c) => aberto && c.tipos.includes(aberto.tipo));

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 md:p-4">
        <div className="absolute inset-0 bg-black/30" onClick={() => (!sujo || confirm("Sair sem salvar as mudanças?")) && onClose()} />
        <div className="relative bg-white md:rounded-2xl shadow-pop w-full max-w-6xl overflow-y-auto thin-scroll p-4 md:p-6">
          {!aberto ? (
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Abrindo o modelo…
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                <div className="flex-1 min-w-[240px]">
                  <input
                    value={nome}
                    disabled={!podeEditar}
                    onChange={(e) => {
                      setNome(e.target.value);
                      setSujo(true);
                    }}
                    className="w-full font-semibold text-lg rounded-lg border border-transparent hover:border-gray-200 focus:border-brand-400 px-2 py-1 outline-none"
                  />
                  <p className="text-xs text-gray-400 px-2">
                    {aberto.tipo === "EMBALAGEM" ? "Etiqueta de embalagem" : aberto.tipo === "COMPOSICAO" ? "Etiqueta de composição" : "Etiqueta de envio"}
                    {" · "}prévia com uma peça de exemplo · {editado ? "desenho próprio" : "desenho automático (reflui ao mudar o tamanho)"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {podeEditar && editado && (
                    <button
                      type="button"
                      onClick={() => confirm("Descartar o desenho próprio e voltar ao desenho automático deste tipo?") && voltarAoAutomatico()}
                      className="rounded-xl border border-gray-200 hover:border-gray-300 text-gray-600 text-xs font-medium px-3 py-2"
                    >
                      Voltar ao automático
                    </button>
                  )}
                  {podeEditar && (
                    <button
                      type="button"
                      onClick={salvar}
                      disabled={busy || !cabe}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />} Salvar modelo
                    </button>
                  )}
                  <button onClick={() => (!sujo || confirm("Sair sem salvar as mudanças?")) && onClose()} className="text-gray-400 p-1" aria-label="Fechar">
                    <X className="size-5" />
                  </button>
                </div>
              </div>
              {msg && <p className={`text-sm mb-3 ${msg.tipo === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{msg.texto}</p>}
              {!cabe && (
                <p className="text-sm mb-3 text-rose-600">
                  Um elemento está saindo da etiqueta, ou a linha do rolo passa de {LARGURA_LINHA_MAX_MM} mm. Arraste para dentro ou ajuste o tamanho.
                </p>
              )}

              <div className="grid lg:grid-cols-[1fr_300px] gap-5">
                {/* ÁREA DE DESENHO + arraste */}
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {podeEditar && (
                      <>
                        <button type="button" onClick={() => novoTexto("texto")} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-300 text-xs font-medium px-2.5 py-1.5">
                          <Type className="size-3.5" /> Texto fixo
                        </button>
                        <select
                          value=""
                          onChange={(e) => e.target.value && novoTexto(e.target.value as ElementoTexto["campo"])}
                          className="rounded-lg border border-gray-200 text-xs font-medium px-2 py-1.5"
                        >
                          <option value="">+ Campo da peça…</option>
                          {camposDoTipo.filter((c) => c.campo !== "texto").map((c) => (
                            <option key={c.campo} value={c.campo}>{c.rotulo}</option>
                          ))}
                        </select>
                        {aberto.tipo !== "ENVIO" && (
                          <button type="button" onClick={() => adicionar({ tipo: "barras", x: 2, y: 2, w: Math.min(45, area.w - 4), h: 10, numero: true })} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-300 text-xs font-medium px-2.5 py-1.5">
                            <Barcode className="size-3.5" /> Código de barras
                          </button>
                        )}
                        <label className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-300 text-xs font-medium px-2.5 py-1.5 cursor-pointer">
                          <ImagePlus className="size-3.5" /> Imagem
                          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && escolherImagem(e.target.files[0])} />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="overflow-auto rounded-xl bg-gray-100 p-4">
                    <div
                      ref={canvasRef}
                      className="relative bg-white shadow-sm select-none"
                      style={{ width: area.w * escala, height: area.h * escala }}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onClick={() => setSel(null)}
                    >
                      <div className="absolute inset-0 [&>svg]:w-full [&>svg]:h-full pointer-events-none" dangerouslySetInnerHTML={{ __html: svgDesenho }} />
                      {elementos.map((el, i) => {
                        const h = el.tipo === "barras" ? el.h + (el.numero ? 2.5 : 0) : el.h;
                        const on = sel === i;
                        return (
                          <div
                            key={i}
                            onPointerDown={onPointerDown(i, "mover")}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSel(i);
                            }}
                            title={el.tipo === "texto" ? CAMPOS.find((c) => c.campo === el.campo)?.rotulo : el.tipo === "barras" ? "Código de barras" : "Imagem"}
                            className={`absolute cursor-move rounded-sm ${on ? "ring-2 ring-brand-500 bg-brand-500/10" : "ring-1 ring-transparent hover:ring-brand-300"}`}
                            style={{ left: el.x * escala, top: el.y * escala, width: el.w * escala, height: h * escala }}
                          >
                            {on && podeEditar && (
                              <div
                                onPointerDown={onPointerDown(i, "redimensionar")}
                                className="absolute -right-1.5 -bottom-1.5 size-3 rounded-sm bg-brand-600 cursor-nwse-resize"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Área de desenho: {area.w} × {area.h} mm{tam.girada ? " (etiqueta girada: o desenho sai deitado)" : ""}. Clique num elemento para editar; arraste para mover; o canto para redimensionar.
                  </p>
                  <p className="text-xs text-gray-500 mt-3 mb-1">Como sai no rolo{tam.colunas > 1 ? ` (${tam.colunas} colunas, ${larguraDaLinha(modelo)} mm)` : ""}:</p>
                  <div className="inline-block rounded-lg bg-gray-50 p-3 [&>svg]:max-w-full [&>svg]:h-auto" style={{ width: `min(100%, ${larguraDaLinha(modelo) * 3 + 24}px)` }} dangerouslySetInnerHTML={{ __html: svgRolo }} />
                </div>

                {/* PAINEL */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-100 p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rolo</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-gray-500">Largura (mm)
                        <input type="number" min={LARGURA_MIN_MM} max={LARGURA_MAX_MM} step={1} value={tam.larguraMm} disabled={!podeEditar} onChange={(e) => mudarTam({ larguraMm: Number(e.target.value) || 0 })} className={campo} />
                      </label>
                      <label className="text-[11px] text-gray-500">Altura (mm)
                        <input type="number" min={ALTURA_MIN_MM} max={ALTURA_MAX_MM} step={1} value={tam.alturaMm} disabled={!podeEditar} onChange={(e) => mudarTam({ alturaMm: Number(e.target.value) || 0 })} className={campo} />
                      </label>
                      <label className="text-[11px] text-gray-500">Colunas
                        <input type="number" min={1} max={COLUNAS_MAX} step={1} value={tam.colunas} disabled={!podeEditar} onChange={(e) => mudarTam({ colunas: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className={campo} />
                      </label>
                      <label className="text-[11px] text-gray-500">Espaço (mm)
                        <input type="number" min={0} max={ESPACO_MAX_MM} step={0.5} value={tam.espacoMm} disabled={!podeEditar} onChange={(e) => mudarTam({ espacoMm: Number(e.target.value) || 0 })} className={campo} />
                      </label>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={tam.girada} disabled={!podeEditar} onChange={(e) => mudarTam({ girada: e.target.checked })} />
                      Etiqueta girada (desenho deitado, sai a 90°)
                    </label>
                  </div>

                  <div className="rounded-xl border border-gray-100 p-3 space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Elementos</p>
                    <div className="max-h-40 overflow-y-auto thin-scroll divide-y divide-gray-50 rounded-lg border border-gray-100">
                      {elementos.map((el, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSel(i)}
                          className={`w-full text-left px-2 py-1 text-xs flex items-center gap-1.5 ${sel === i ? "bg-brand-50 text-brand-800" : "hover:bg-gray-50"}`}
                        >
                          {el.tipo === "texto" ? <Type className="size-3" /> : el.tipo === "barras" ? <Barcode className="size-3" /> : <ImagePlus className="size-3" />}
                          <span className="truncate">
                            {el.tipo === "texto" ? (el.campo === "texto" ? `"${el.texto ?? ""}"` : CAMPOS.find((c) => c.campo === el.campo)?.rotulo) : el.tipo === "barras" ? "Código de barras" : "Imagem"}
                          </span>
                        </button>
                      ))}
                      {elementos.length === 0 && <p className="px-2 py-2 text-xs text-gray-400">Etiqueta vazia. Adicione texto, campo, código ou imagem.</p>}
                    </div>
                    {elSel && podeEditar && (
                      <div className="flex items-center gap-1">
                        <button type="button" title="Trazer para cima na ordem" onClick={() => sel !== null && sel > 0 && (mudar((els) => { const c = [...els]; [c[sel - 1], c[sel]] = [c[sel], c[sel - 1]]; return c; }), setSel(sel - 1))} className="rounded-lg border border-gray-200 p-1.5 text-gray-500"><ArrowUp className="size-3.5" /></button>
                        <button type="button" title="Levar para baixo na ordem" onClick={() => sel !== null && sel < elementos.length - 1 && (mudar((els) => { const c = [...els]; [c[sel + 1], c[sel]] = [c[sel], c[sel + 1]]; return c; }), setSel(sel + 1))} className="rounded-lg border border-gray-200 p-1.5 text-gray-500"><ArrowDown className="size-3.5" /></button>
                        <button type="button" title="Duplicar" onClick={() => sel !== null && (mudar((els) => [...els, { ...els[sel], y: els[sel].y + 2 } as Elemento]), setSel(elementos.length))} className="rounded-lg border border-gray-200 p-1.5 text-gray-500"><Copy className="size-3.5" /></button>
                        <button type="button" title="Remover" onClick={() => sel !== null && (mudar((els) => els.filter((_, i) => i !== sel)), setSel(null))} className="rounded-lg border border-gray-200 hover:border-rose-300 p-1.5 text-gray-500 hover:text-rose-600 ml-auto"><X className="size-3.5" /></button>
                      </div>
                    )}
                  </div>

                  {elSel && (
                    <div className="rounded-xl border border-gray-100 p-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {elSel.tipo === "texto" ? "Texto" : elSel.tipo === "barras" ? "Código de barras" : "Imagem"}
                      </p>
                      {elSel.tipo === "texto" && (
                        <>
                          <label className="text-[11px] text-gray-500">O que mostra
                            <select value={elSel.campo} disabled={!podeEditar} onChange={(e) => mudarSel({ campo: e.target.value as ElementoTexto["campo"] })} className={campo}>
                              {camposDoTipo.map((c) => <option key={c.campo} value={c.campo}>{c.rotulo}</option>)}
                            </select>
                          </label>
                          {elSel.campo === "texto" && (
                            <label className="text-[11px] text-gray-500">Texto
                              <input value={elSel.texto ?? ""} disabled={!podeEditar} onChange={(e) => mudarSel({ texto: e.target.value } as Partial<Elemento>)} className={campo} />
                            </label>
                          )}
                          <div className="grid grid-cols-3 gap-2">
                            <label className="text-[11px] text-gray-500">Letra (pt)
                              <input type="number" min={3} max={72} step={0.5} value={elSel.pt} disabled={!podeEditar} onChange={(e) => mudarSel({ pt: Math.max(3, Number(e.target.value) || 3) } as Partial<Elemento>)} className={campo} />
                            </label>
                            <label className="text-[11px] text-gray-500">Linhas
                              <input type="number" min={1} max={10} step={1} value={elSel.linhas ?? 1} disabled={!podeEditar} onChange={(e) => mudarSel({ linhas: Math.max(1, Math.floor(Number(e.target.value) || 1)) } as Partial<Elemento>)} className={campo} />
                            </label>
                            <label className="text-[11px] text-gray-500">Alinhar
                              <select value={elSel.alinhar ?? "esq"} disabled={!podeEditar} onChange={(e) => mudarSel({ alinhar: e.target.value as ElementoTexto["alinhar"] } as Partial<Elemento>)} className={campo}>
                                <option value="esq">esquerda</option>
                                <option value="centro">centro</option>
                                <option value="dir">direita</option>
                              </select>
                            </label>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-gray-700">
                            <input type="checkbox" checked={!!elSel.negrito} disabled={!podeEditar} onChange={(e) => mudarSel({ negrito: e.target.checked } as Partial<Elemento>)} />
                            Negrito (na Zebra a fonte é a da impressora)
                          </label>
                        </>
                      )}
                      {elSel.tipo === "barras" && (
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                          <input type="checkbox" checked={elSel.numero} disabled={!podeEditar} onChange={(e) => mudarSel({ numero: e.target.checked } as Partial<Elemento>)} />
                          Mostrar o número embaixo
                        </label>
                      )}
                      {elSel.tipo === "imagem" && podeEditar && (
                        <label className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-brand-300 text-xs font-medium px-2.5 py-1.5 cursor-pointer">
                          <ImagePlus className="size-3.5" /> Trocar imagem
                          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { mudarSel({ src: await imagemParaModelo(f), bitmap: undefined } as Partial<Elemento>); } catch { setMsg({ tipo: "erro", texto: "Não deu para ler essa imagem." }); } }} />
                        </label>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {numero("x")}
                        {numero("y")}
                        {numero("w")}
                        {numero("h")}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
