/**
 * Gráficos leves renderizados no servidor (sem lib externa).
 * Rampa ordinal quente (manual da marca, light→dark):
 * ocre claro → ocre → cobre → cobre escuro → espresso
 * Barras têm rótulo direto (valor visível) — nunca só cor.
 */

export const ORDINAL_RAMP = [
  "#dbba8b",
  "#c99b5f",
  "#c4622d",
  "#8a4420",
  "#3a2a1e",
];

import { InfoTip } from "./info-tip";

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  info?: string;
}) {
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
  return (
    <div className="group min-w-0 bg-white rounded-2xl border border-slate-200/70 shadow-card p-4 md:p-5 transition duration-200 hover:shadow-pop hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2 mb-2.5 md:mb-3">
        <p className="text-[10px] md:text-[11px] font-semibold text-slate-400 uppercase tracking-wider leading-tight flex items-center gap-1">
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
      <p
        className={`text-lg sm:text-2xl md:text-[26px] leading-none font-semibold tracking-tight tabular-nums truncate ${toneCls}`}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[11px] md:text-xs text-slate-400 mt-1.5 md:mt-2 leading-snug">
          {hint}
        </p>
      )}
    </div>
  );
}

export function BarList({
  data,
  color = "#c4622d",
  formatValue = (v) => String(v),
}: {
  data: { label: string; value: number; sub?: string }[];
  color?: string;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm mb-1">
            <span className="font-medium truncate text-slate-700">{d.label}</span>
            <span className="text-slate-500 font-medium tabular-nums shrink-0">
              {formatValue(d.value)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max((d.value / max) * 100, 2)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          {d.sub && <p className="text-[11px] text-slate-400 mt-1">{d.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** Funil: barras horizontais em rampa ordinal, largura proporcional. */
export function FunnelBars({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const color =
          ORDINAL_RAMP[
            Math.min(
              Math.floor((i / Math.max(data.length - 1, 1)) * (ORDINAL_RAMP.length - 1)),
              ORDINAL_RAMP.length - 1
            )
          ];
        return (
          <div key={d.label} className="flex items-center gap-3">
            <span className="w-40 md:w-48 text-xs text-slate-600 truncate shrink-0">
              {d.label}
            </span>
            <div className="flex-1 h-6 flex items-center">
              <div
                className="h-6 rounded-lg min-w-1 transition-all"
                style={{
                  width: `${(d.value / max) * 100}%`,
                  backgroundColor: color,
                }}
                title={`${d.label}: ${d.value}`}
              />
              <span className="ml-2 text-xs font-semibold tabular-nums text-slate-700">
                {d.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Área/linha simples para série temporal (SVG servidor). */
export function AreaChart({
  points,
  labels,
  formatValue = (v) => String(v),
  height = 180,
}: {
  points: number[];
  labels: string[];
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const w = 600;
  const h = height;
  const pad = { top: 16, right: 8, bottom: 24, left: 8 };
  const max = Math.max(...points, 1);
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const step = points.length > 1 ? iw / (points.length - 1) : iw;
  const xy = points.map((v, i) => [
    pad.left + i * step,
    pad.top + ih - (v / max) * ih,
  ]);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = `${line} L${pad.left + (points.length - 1) * step},${pad.top + ih} L${pad.left},${pad.top + ih} Z`;
  const maxIdx = points.indexOf(Math.max(...points));

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto"
      role="img"
      aria-label="Vendas por período"
    >
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c4622d" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#c4622d" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={pad.left}
          x2={w - pad.right}
          y1={pad.top + ih * f}
          y2={pad.top + ih * f}
          stroke="#eef2f7"
          strokeWidth="1"
        />
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path
        d={line}
        fill="none"
        stroke="#c4622d"
        strokeWidth="2.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {xy.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="8" fill="transparent">
            <title>{`${labels[i]}: ${formatValue(points[i])}`}</title>
          </circle>
          <circle
            cx={x}
            cy={y}
            r={i === maxIdx ? 4 : 3}
            fill="#c4622d"
            stroke="#fff"
            strokeWidth="2"
          />
        </g>
      ))}
      {/* rótulo direto apenas no pico (seletivo) */}
      {points[maxIdx] > 0 && (
        <text
          x={Math.min(Math.max(xy[maxIdx][0], 30), w - 40)}
          y={Math.max(xy[maxIdx][1] - 10, 12)}
          textAnchor="middle"
          className="fill-slate-600"
          fontSize="11"
          fontWeight="600"
        >
          {formatValue(points[maxIdx])}
        </text>
      )}
      {labels.map((l, i) =>
        i % Math.ceil(labels.length / 6) === 0 ? (
          <text
            key={i}
            x={xy[i][0]}
            y={h - 6}
            textAnchor="middle"
            fontSize="10"
            className="fill-slate-400"
          >
            {l}
          </text>
        ) : null
      )}
    </svg>
  );
}
