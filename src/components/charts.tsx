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
  delta,
  deltaHint = "vs. período anterior",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  info?: string;
  /** variação % vs. período anterior (null = sem base para comparar) */
  delta?: number | null;
  deltaHint?: string;
}) {
  // mesma régua do StatCard do Dashboard: 0% é "igual" (selo neutro), não
  // seta verde — o corte segue o arredondamento exibido
  const temDelta = delta != null && Number.isFinite(delta);
  const estavel = temDelta && Math.abs(delta!) < 0.05;
  const sobe = temDelta && delta! > 0;
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
      <p
        className={`text-lg sm:text-2xl md:text-[26px] leading-[1.15] pb-0.5 font-semibold tracking-tight tabular-nums truncate ${toneCls}`}
      >
        {value}
      </p>
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
      {data.map((d, i) => (
        // label sozinho repetia a key com clientes homônimas
        <div key={`${d.label}-${i}`}>
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
          className="stroke-gray-100"
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
            className="stroke-white"
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

/**
 * Área comparativa: período atual (linha cheia cobre) sobre o período
 * anterior (linha tracejada ocre claro). As duas séries têm o mesmo
 * comprimento — dia 1 do período atual alinha com dia 1 do anterior.
 */
export function AreaCompare({
  points,
  prevPoints,
  labels,
  formatValue = (v) => String(v),
  height = 200,
}: {
  points: number[];
  prevPoints: number[];
  labels: string[];
  formatValue?: (v: number) => string;
  height?: number;
}) {
  const w = 600;
  const h = height;
  const pad = { top: 16, right: 8, bottom: 24, left: 8 };
  const max = Math.max(...points, ...prevPoints, 1);
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const n = points.length;
  const step = n > 1 ? iw / (n - 1) : iw;
  const toXY = (serie: number[]) =>
    serie.map((v, i) => [pad.left + i * step, pad.top + ih - (v / max) * ih]);
  const path = (serie: number[]) =>
    toXY(serie)
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
  const xy = toXY(points);
  const line = path(points);
  const area = `${line} L${(pad.left + (n - 1) * step).toFixed(1)},${pad.top + ih} L${pad.left},${pad.top + ih} Z`;
  const maxIdx = points.indexOf(Math.max(...points));

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto"
      role="img"
      aria-label="Comparativo com o período anterior"
    >
      <defs>
        <linearGradient id="areaCompareFill" x1="0" y1="0" x2="0" y2="1">
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
          className="stroke-gray-100"
          strokeWidth="1"
        />
      ))}
      {/* período anterior: tracejado, sem preenchimento (referência) */}
      {prevPoints.length > 1 && (
        <path
          d={path(prevPoints)}
          fill="none"
          stroke="#dbba8b"
          strokeWidth="1.75"
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <path d={area} fill="url(#areaCompareFill)" />
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
            <title>{`${labels[i]}: ${formatValue(points[i])}${prevPoints[i] != null ? ` · anterior: ${formatValue(prevPoints[i])}` : ""}`}</title>
          </circle>
          <circle
            cx={x}
            cy={y}
            r={i === maxIdx ? 4 : 2.5}
            fill="#c4622d"
            className="stroke-white"
            strokeWidth="2"
          />
        </g>
      ))}
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

/**
 * Donut de composição (ex.: status dos pedidos). Cada fatia SEMPRE aparece
 * na legenda com nome + quantidade + % — nunca só cor.
 */
export function Donut({
  data,
  centerValue,
  centerLabel,
  formatValue = (v) => String(v),
}: {
  data: { label: string; value: number; color: string }[];
  centerValue: string;
  centerLabel: string;
  formatValue?: (v: number) => string;
}) {
  const itens = data.filter((d) => d.value > 0);
  const total = itens.reduce((a, d) => a + d.value, 0);
  if (total === 0) return null;
  // valor do centro se adapta ao tamanho pra não estourar o furo (~90px):
  // medido com "R$ 316.215,31" (13 letras) — em text-sm passava da borda,
  // em text-xs cabe; acima de 13 (casa do milhão) só cabe em 10px
  const vlen = centerValue.length;
  const valueSize =
    vlen <= 6 ? "text-xl" : vlen <= 8 ? "text-lg" : vlen <= 10 ? "text-base" : vlen <= 12 ? "text-sm" : vlen <= 13 ? "text-xs" : "text-[10px]";
  const r = 15.915; // raio que dá circunferência 100 (facilita o dasharray em %)
  let acc = 0;
  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative size-36 shrink-0">
        <svg viewBox="0 0 42 42" className="size-36 -rotate-90" role="img" aria-label={centerLabel}>
          {itens.map((d) => {
            const frac = (d.value / total) * 100;
            const seg = (
              <circle
                key={d.label}
                cx="21"
                cy="21"
                r={r}
                fill="transparent"
                stroke={d.color}
                strokeWidth="5.5"
                strokeDasharray={`${Math.max(frac - 1.2, 0.4)} ${100 - Math.max(frac - 1.2, 0.4)}`}
                strokeDashoffset={-acc}
                strokeLinecap="round"
              >
                <title>{`${d.label}: ${formatValue(d.value)}`}</title>
              </circle>
            );
            acc += frac;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
          <p className={`${valueSize} font-bold tabular-nums text-slate-800 leading-none whitespace-nowrap`}>{centerValue}</p>
          <p className="text-[10px] text-slate-400 mt-1 leading-tight max-w-[80px]">{centerLabel}</p>
        </div>
      </div>
      <ul className="flex-1 min-w-[180px] space-y-1.5">
        {itens.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-xs">
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: d.color }}
              aria-hidden="true"
            />
            <span className="text-slate-600 truncate flex-1">{d.label}</span>
            <span className="font-semibold tabular-nums text-slate-700">{formatValue(d.value)}</span>
            <span className="text-slate-400 tabular-nums w-10 text-right">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Atalhos de período (Hoje · 7 dias · 30 dias · Este mês · Mês passado) +
 * período personalizado De/Até.
 *
 * Mora em `period-chips.tsx` porque precisa RODAR NO NAVEGADOR: trocar o
 * período é navegação para a mesma tela, e sem um aviso de "estou indo
 * buscar" a tela parecia travada (ver o comentário grande de lá). Este
 * arquivo continua sendo o endereço conhecido do componente.
 */
export { PeriodChips } from "./period-chips";
