"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  COR_DA_SERIE,
  conversaoDoFunil,
  estiloDoFunil,
  formatarValor,
  geometriaDaSerie,
  indiceMaisPerto,
  posicaoDoBalao,
  type FormatoDoValor,
} from "@/lib/bi/paleta";

/**
 * GRÁFICOS VIVOS DO BI (RN-089): os mesmos dados dos gráficos de servidor,
 * com a camada de interação que a disciplina de visualização pede — a mira
 * encontra a data pela posição (o dedo nunca precisa acertar uma linha de
 * 2 px; no toque, a seleção fica até o próximo toque), o balão mostra o
 * valor, o teclado anda pelos pontos, e o rótulo direto é só no pico e no
 * último ponto (sem colidir). O ESTADO FINAL vem do servidor — a tela é
 * legível antes do JavaScript; a entrada anima por `@starting-style` (CSS),
 * e "reduzir movimento" zera. `formato` é serializável: função não
 * atravessa a fronteira servidor → navegador. A largura das barras vai por
 * variável CSS (`--gv-w`): `width` inline venceria o `@starting-style` e a
 * barra nunca crescia. A cor do funil é um token (`corDoFunil`) que o tema
 * escuro troca por uma rampa própria, validada.
 */

/** a seleção por toque fica; por mouse, sai ao sair (hook comum aos três gráficos) */
function useSelecao(caixa: React.RefObject<HTMLElement | null>) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const porToque = useRef(false);
  useEffect(() => {
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        porToque.current = false;
        setAtivo(null);
      }
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [caixa]);
  const sair = () => {
    if (!porToque.current) setAtivo(null);
  };
  const marcarToque = (e: React.PointerEvent) => {
    porToque.current = e.pointerType === "touch";
  };
  return { ativo, setAtivo, sair, marcarToque };
}

/** o balão (classe própria: no tema escuro o bg-slate-900 vira creme e o text-white ficaria invisível) */
const BALAO = "pointer-events-none absolute z-10 rounded-lg gv-balao text-xs px-2.5 py-1.5 shadow-lg";
const SUB = "gv-balao-sub";

/**
 * A navegação por teclado de uma LISTA de barras: um foco só por gráfico
 * (vinte paradas de Tab por painel, uma por barra, afastavam o teclado da
 * tela); as setas andam, Esc solta.
 */
function tecladoDaLista(n: number, setAtivo: React.Dispatch<React.SetStateAction<number | null>>) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") setAtivo((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") setAtivo((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === "Escape") setAtivo(null);
    else return;
    e.preventDefault();
  };
}

/** a largura da barra como variável CSS (a transição de entrada depende disso) */
function larguraDaBarra(value: number, max: number): React.CSSProperties {
  return { "--gv-w": `${Math.max((value / max) * 100, value > 0 ? 1.5 : 0)}%` } as React.CSSProperties;
}

export function SerieViva({
  points,
  labels,
  formato = "int",
  height = 180,
  titulo,
}: {
  points: number[];
  labels: string[];
  formato?: FormatoDoValor;
  height?: number;
  titulo: string;
}) {
  const fmt = (v: number) => formatarValor(v, formato);
  // a geometria é pura e só depende dos dados — não se refaz a cada passada do mouse
  const g = useMemo(
    () => geometriaDaSerie(points, { h: height, larguraDoRotulo: (i) => formatarValor(points[i], formato).length * 6.5 + 8 }),
    [points, height, formato]
  );
  const { w, h, pad, n, iw, ih, xy, maxIdx } = g;
  const gid = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const { ativo, setAtivo, sair, marcarToque } = useSelecao(caixa);
  if (n === 0) return <p className="text-xs text-gray-400">Sem dados no período.</p>;

  const mover = (clientX: number) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const fracao = (clientX - r.left - (pad.left / w) * r.width) / ((iw / w) * r.width);
    setAtivo(indiceMaisPerto(fracao, n));
  };
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") setAtivo((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setAtivo((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === "Escape") setAtivo(null);
    else return;
    e.preventDefault();
  };
  const rotulado = new Map(g.rotulos.map((r) => [r.i, r]));
  // a seleção sobrevive à troca de período (voltar do 30 dias para o 7 com o dedo ainda no gráfico): fora da série, não vale
  const a = ativo != null && ativo < n ? ativo : null;
  // o balão não sai da caixa: perto da borda ele se ancora pelo lado de dentro
  const ancora = a == null ? "centro" : posicaoDoBalao(xy[a][0] / w);
  const estiloDoBalao: React.CSSProperties | undefined =
    a == null
      ? undefined
      : {
          top: `${Math.max((xy[a][1] / h) * 100 - 18, 0)}%`,
          ...(ancora === "direita" ? { right: `${100 - (xy[a][0] / w) * 100}%` } : { left: `${(xy[a][0] / w) * 100}%` }),
          ...(ancora === "centro" ? { transform: "translateX(-50%)" } : {}),
        };

  return (
    <div
      ref={caixa}
      /* touch-pan-y: o arrasto lateral do dedo é do gráfico (sem isso a página toma o toque como rolagem e a mira congela) */
      className="relative outline-none focus-visible:ring-2 ring-brand-300 rounded-lg touch-pan-y select-none"
      tabIndex={0}
      role="group"
      aria-roledescription="gráfico"
      aria-label={`${titulo}: ${n} pontos, pico ${fmt(points[maxIdx])} em ${labels[maxIdx] ?? ""}. Use as setas para percorrer.`}
      onPointerDown={(e) => {
        marcarToque(e);
        mover(e.clientX);
      }}
      onPointerMove={(e) => mover(e.clientX)}
      onPointerLeave={sair}
      onFocus={() => setAtivo((x) => x ?? n - 1)}
      onBlur={() => setAtivo(null)}
      onKeyDown={tecla}
      data-testid="serie-viva"
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COR_DA_SERIE} stopOpacity="0.16" />
            <stop offset="100%" stopColor={COR_DA_SERIE} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.left} x2={w - pad.right} y1={pad.top + ih * f} y2={pad.top + ih * f} className="stroke-slate-100" strokeWidth="1" />
        ))}
        <path d={g.area} fill={`url(#${gid})`} className="gv-area" />
        <path d={g.linha} fill="none" stroke={COR_DA_SERIE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={0} className="gv-linha" />
        {a != null && <line x1={xy[a][0]} x2={xy[a][0]} y1={pad.top} y2={pad.top + ih} className="stroke-slate-300" strokeWidth="1" />}
        {xy.map(([x, y], i) => {
          const vivo = i === a;
          const rotulo = rotulado.get(i);
          if (!vivo && !rotulo) return null;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={vivo ? 5 : 4} fill={COR_DA_SERIE} className="stroke-white" strokeWidth="2" />
              {rotulo && points[i] > 0 && !vivo && (
                <text x={rotulo.x} y={rotulo.y} textAnchor="middle" className="fill-slate-600" fontSize="11" fontWeight="600">
                  {fmt(points[i])}
                </text>
              )}
            </g>
          );
        })}
        {g.eixo.map((i) => (
          <text key={i} x={xy[i][0]} y={h - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="10" className="fill-slate-400">
            {labels[i]}
          </text>
        ))}
      </svg>
      {/* o balão: leitor de tela anuncia a mudança (fora do SVG, que é decorativo) */}
      <div role="status" aria-live="polite" className={a == null ? "sr-only" : BALAO} style={estiloDoBalao}>
        {a != null && (
          <>
            <span className="font-semibold tabular-nums">{fmt(points[a])}</span>
            <span className={SUB}> · {labels[a]}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Funil com a conversão de cada etapa (% da anterior · % do começo) e balão. */
export function FunilVivo({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const conv = useMemo(() => conversaoDoFunil(data), [data]);
  const caixa = useRef<HTMLOListElement>(null);
  const { ativo, setAtivo, sair, marcarToque } = useSelecao(caixa);
  const vivo = ativo != null && ativo < data.length ? data[ativo] : null;
  return (
    <div className="relative">
      <ol
        ref={caixa}
        className="space-y-2.5 outline-none focus-visible:ring-2 ring-brand-300 rounded"
        aria-label="Funil. Use as setas para percorrer as etapas."
        tabIndex={0}
        onKeyDown={tecladoDaLista(data.length, setAtivo)}
        onFocus={() => setAtivo((x) => x ?? 0)}
        onBlur={() => setAtivo(null)}
      >
        {data.map((d, i) => {
          const c = conv[i];
          return (
            <li
              key={d.label}
              onPointerDown={(e) => {
                marcarToque(e);
                setAtivo(i);
              }}
              onPointerEnter={() => setAtivo(i)}
              onPointerLeave={sair}
            >
              <div className="flex items-baseline justify-between gap-2 text-xs mb-1">
                <span className="text-slate-600 truncate">{d.label}</span>
                <span className="font-semibold tabular-nums text-slate-700 shrink-0">
                  {d.value}
                  {c.daAnterior != null && <span className="text-slate-400 font-normal"> · {c.daAnterior}% da anterior</span>}
                </span>
              </div>
              <div className="relative h-5 rounded-r-md bg-slate-100/70">
                <div
                  className="h-5 rounded-r-md gv-barra gv-funil"
                  style={{ ...larguraDaBarra(d.value, max), ...estiloDoFunil(i, data.length), opacity: ativo == null || ativo === i ? 1 : 0.55 }}
                />
                {ativo === i && (
                  /* preso ao cartão: começa na borda esquerda e QUEBRA linha — no celular estreito o balão de uma linha saía da tela */
                  <div aria-hidden="true" className={`${BALAO} left-0 bottom-full mb-1 max-w-full whitespace-normal`}>
                    <span className="font-semibold tabular-nums">{d.value}</span>
                    <span className={SUB}>
                      {" "}
                      · {d.label}
                      {c.daPrimeira != null ? ` · ${c.daPrimeira}% do começo` : ""}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {/* a região viva é PERMANENTE: a que nasce junto com o balão não é anunciada */}
      <div role="status" aria-live="polite" className="sr-only">
        {vivo && ativo != null ? `${vivo.value} · ${vivo.label}${conv[ativo].daPrimeira != null ? ` · ${conv[ativo].daPrimeira}% do começo` : ""}` : ""}
      </div>
    </div>
  );
}

/** Barras horizontais de uma cor só (categoria nominal ou ordenada), valor na ponta, balão. */
export function BarrasVivas({ data, formato = "int" }: { data: { label: string; value: number; sub?: string }[]; formato?: FormatoDoValor }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const caixa = useRef<HTMLUListElement>(null);
  const { ativo, setAtivo, sair, marcarToque } = useSelecao(caixa);
  const vivo = ativo != null && ativo < data.length ? data[ativo] : null;
  return (
    <div className="relative">
      <ul
        ref={caixa}
        className="space-y-3 outline-none focus-visible:ring-2 ring-brand-300 rounded"
        tabIndex={0}
        aria-label="Barras. Use as setas para percorrer."
        onKeyDown={tecladoDaLista(data.length, setAtivo)}
        onFocus={() => setAtivo((x) => x ?? 0)}
        onBlur={() => setAtivo(null)}
      >
        {data.map((d, i) => (
          <li
            key={`${d.label}-${i}`}
            onPointerDown={(e) => {
              marcarToque(e);
              setAtivo(i);
            }}
            onPointerEnter={() => setAtivo(i)}
            onPointerLeave={sair}
            className={ativo === i ? "rounded ring-2 ring-brand-300/60" : ""}
          >
            <div className="flex items-baseline justify-between gap-2 text-sm mb-1">
              <span className="font-medium truncate text-slate-700">{d.label}</span>
              <span className="text-slate-500 font-medium tabular-nums shrink-0">{formatarValor(d.value, formato)}</span>
            </div>
            <div className="relative h-2.5 rounded-r bg-slate-100/70">
              <div
                className="h-2.5 rounded-r gv-barra"
                style={{ ...larguraDaBarra(d.value, max), backgroundColor: COR_DA_SERIE, opacity: ativo == null || ativo === i ? 1 : 0.55 }}
              />
            </div>
            {d.sub && <p className="text-[11px] text-gray-400 mt-1">{d.sub}</p>}
          </li>
        ))}
      </ul>
      <div role="status" aria-live="polite" className="sr-only">
        {vivo ? `${formatarValor(vivo.value, formato)} · ${vivo.label}` : ""}
      </div>
    </div>
  );
}
