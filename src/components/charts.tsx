/**
 * Gráficos leves renderizados no servidor (sem lib externa).
 * Cores seguem rampa ordinal violeta validada (CVD-safe):
 * #a78bfa → #8b5cf6 → #7c3aed → #5b21b6 → #3b1a78
 * Barras têm rótulo direto (valor visível) — nunca só cor.
 */

export const ORDINAL_RAMP = [
  "#a78bfa",
  "#8b5cf6",
  "#7c3aed",
  "#5b21b6",
  "#3b1a78",
];

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "bad"
          ? "text-rose-600"
          : "text-ink";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-4 md:p-5 animate-fade-up">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </p>
        {icon && <span className="text-gray-300 [&>svg]:size-4">{icon}</span>}
      </div>
      <p className={`text-xl md:text-2xl font-semibold tracking-tight ${toneCls}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function BarList({
  data,
  color = "#7c3aed",
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
            <span className="font-medium truncate">{d.label}</span>
            <span className="text-gray-600 tabular-nums shrink-0">
              {formatValue(d.value)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max((d.value / max) * 100, 2)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          {d.sub && <p className="text-[11px] text-gray-400 mt-0.5">{d.sub}</p>}
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
            <span className="w-40 md:w-48 text-xs text-gray-600 truncate shrink-0">
              {d.label}
            </span>
            <div className="flex-1 h-6 flex items-center">
              <div
                className="h-6 rounded-md min-w-1"
                style={{
                  width: `${(d.value / max) * 100}%`,
                  backgroundColor: color,
                }}
                title={`${d.label}: ${d.value}`}
              />
              <span className="ml-2 text-xs font-medium tabular-nums text-gray-700">
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
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={pad.left}
          x2={w - pad.right}
          y1={pad.top + ih * f}
          y2={pad.top + ih * f}
          stroke="#f1f0f5"
          strokeWidth="1"
        />
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path
        d={line}
        fill="none"
        stroke="#7c3aed"
        strokeWidth="2"
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
            fill="#7c3aed"
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
          className="fill-gray-600"
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
            className="fill-gray-400"
          >
            {l}
          </text>
        ) : null
      )}
    </svg>
  );
}
