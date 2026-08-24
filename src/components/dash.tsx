"use client";

/**
 * Cartões de indicador "vivos" do dashboard:
 *  - número com animação de contagem (respeita prefers-reduced-motion)
 *  - selo de variação % contra o período anterior (▲ verde / ▼ vermelho)
 *  - mini-gráfico (sparkline) da série diária dentro do próprio cartão
 * O valor vem como NÚMERO (não string) pra animação funcionar; `format`
 * resolve a exibição em pt-BR.
 */

import { useEffect, useId, useRef, useState } from "react";
import { InfoTip } from "./info-tip";

type Fmt = "brl" | "int" | "pct" | "kg" | "num";

function exibe(v: number, format: Fmt, decimals?: number, suffix?: string) {
  const d = decimals ?? (format === "brl" ? 2 : format === "kg" ? 1 : 0);
  const s = v.toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  const base =
    format === "brl"
      ? `R$ ${s}`
      : format === "pct"
        ? `${s}%`
        : format === "kg"
          ? `${s} kg`
          : s;
  return suffix ? `${base}${suffix}` : base;
}

/** Anima a contagem de 0 (ou do valor anterior) até `value` em ~700ms. */
function useContagem(value: number) {
  const [display, setDisplay] = useState(value);
  const atual = useRef(value);
  const primeira = useRef(true);

  useEffect(() => {
    const reduz =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const de = primeira.current ? 0 : atual.current;
    primeira.current = false;
    if (reduz || de === value) {
      atual.current = value;
      setDisplay(value);
      return;
    }
    const t0 = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      const v = de + (value - de) * ease;
      atual.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return display;
}

function Sparkline({ series }: { series: number[] }) {
  const gid = useId();
  if (series.length < 2) return null;
  const w = 120;
  const h = 34;
  const max = Math.max(...series, 1);
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-8 mt-2.5"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c4622d" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#c4622d" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke="#c4622d"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  format = "int",
  decimals,
  suffix,
  hint,
  icon,
  tone = "default",
  info,
  delta,
  deltaHint = "vs. período anterior",
  series,
}: {
  label: string;
  /** null = sem dado ainda (mostra "—") */
  value: number | null;
  format?: Fmt;
  decimals?: number;
  suffix?: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  info?: string;
  /** variação % contra o período anterior; null/undefined esconde o selo */
  delta?: number | null;
  deltaHint?: string;
  series?: number[];
}) {
  const display = useContagem(value ?? 0);

  // UX: o número NUNCA corta. Ele ocupa a largura toda do card e, só quando
  // for grande demais para caber, encolhe a fonte na medida certa (nunca some
  // e nunca vira "R$ 3.00…"). Vale em computador e celular.
  const boxRef = useRef<HTMLDivElement>(null);
  const valRef = useRef<HTMLParagraphElement>(null);
  const [fit, setFit] = useState(1);
  const measureRef = useRef<() => void>(() => {});
  useEffect(() => {
    const v = valRef.current;
    const box = boxRef.current;
    if (!v || !box) return;
    const measure = () => {
      const natural = v.scrollWidth; // largura real do texto (transform não afeta)
      const avail = box.clientWidth;
      setFit(natural > avail && avail > 0 ? Math.max(avail / natural, 0.45) : 1);
    };
    measureRef.current = measure;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    measureRef.current();
  }, [display, format, decimals, suffix]);

  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-rose-600"
          : "text-slate-900";
  const iconTone =
    tone === "good"
      ? "bg-emerald-50 text-emerald-500"
      : tone === "warn"
        ? "bg-amber-50 text-amber-500"
        : tone === "bad"
          ? "bg-rose-50 text-rose-500"
          : "bg-brand-50 text-brand-500";
  const temDelta = delta != null && Number.isFinite(delta);
  // variação que ARREDONDA para 0% é "igual", não "subiu": a seta verde no
  // 0,0% dizia que melhorou quando nada mudou (auditoria 24/08/2026). O corte
  // segue o arredondamento exibido (1 casa abaixo de 10).
  const estavel = temDelta && Math.abs(delta!) < 0.05;
  const sobe = temDelta && delta! >= 0;
  return (
    <div className="group min-w-0 bg-white rounded-2xl border border-slate-200/70 shadow-card p-4 md:p-5 transition duration-200 hover:shadow-pop hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2 mb-2.5 md:mb-3">
        <p className="font-mono text-[10px] md:text-[11px] font-semibold text-slate-400 uppercase tracking-[0.1em] leading-tight flex items-center gap-1">
          {label}
          {info && <InfoTip text={info} />}
        </p>
        {icon && (
          <span
            className={`size-7 md:size-8 shrink-0 rounded-lg flex items-center justify-center transition group-hover:scale-105 [&>svg]:size-3.5 md:[&>svg]:size-4 ${iconTone}`}
          >
            {icon}
          </span>
        )}
      </div>
      {/* número: largura total do card + auto-encolhe pra caber (nunca corta) */}
      <div ref={boxRef} className="overflow-hidden">
        <p
          ref={valRef}
          style={fit < 1 ? { transform: `scale(${fit})`, transformOrigin: "left center" } : undefined}
          className={`inline-block whitespace-nowrap text-lg sm:text-2xl md:text-[26px] leading-[1.15] pb-0.5 font-semibold tracking-tight tabular-nums ${toneCls}`}
        >
          {value == null ? "—" : exibe(display, format, decimals, suffix)}
        </p>
      </div>
      {temDelta && (
        <div className="mt-1">
          <span
            title={deltaHint}
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
              estavel
                ? "bg-slate-100 text-slate-500"
                : sobe
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-rose-50 text-rose-600"
            }`}
          >
            {estavel ? (
              <span aria-hidden="true">=</span>
            ) : (
              <svg viewBox="0 0 10 10" className={`size-2 ${sobe ? "" : "rotate-180"}`} aria-hidden="true">
                <path d="M5 1 L9 7 H1 Z" fill="currentColor" />
              </svg>
            )}
            {Math.abs(delta!).toLocaleString("pt-BR", {
              maximumFractionDigits: Math.abs(delta!) < 10 ? 1 : 0,
            })}
            %
            <span className="sr-only">
              {estavel ? "igual ao" : sobe ? "acima do" : "abaixo do"} período anterior
            </span>
          </span>
        </div>
      )}
      {hint && (
        <p className="text-[11px] md:text-xs text-slate-400 mt-1.5 md:mt-2 leading-snug">{hint}</p>
      )}
      {series && series.some((v) => v > 0) && <Sparkline series={series} />}
    </div>
  );
}
