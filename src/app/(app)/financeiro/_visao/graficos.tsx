import type { PontoPrevisto } from "@/lib/financeiro/painel";
import { formatarDia } from "@/lib/financeiro/dia";
import type { TomDaSaude } from "@/lib/financeiro/saude";
import { marcasDoEixo, valorCurto } from "@/lib/financeiro/eixo";

/**
 * OS GRÁFICOS DO PAINEL DO FINANCEIRO — SVG desenhado no servidor, sem lib.
 *
 * Três peças, com as mesmas regras dos gráficos do Dashboard: marca fina
 * (linha de 2px), grade em fio de cabelo, rótulo direto só onde importa (o
 * fim da linha e o ponto mais baixo), texto sempre em cor de texto — a cor da
 * série fica na marca. Todo valor que a linha mostra também está no texto ao
 * lado (a tela nunca depende do gráfico para dizer um número).
 */

const COBRE = "#c4622d";
const CINZA = "#cbd5e1";
const ROSA = "#e11d48";

/** "05/09" — dia curto para o eixo. */
const diaCurto = (iso: string) => formatarDia(iso).slice(0, 5);

/* ---- sparkline ---------------------------------------------------------- */

/**
 * A linha pequena do card: o mês em cobre por cima do mesmo trecho do mês
 * anterior em cinza. Sem eixo, sem número — o número está no card; a linha
 * só diz o FORMATO (subiu, caiu, ficou parado).
 */
export function Sparkline({
  atual,
  anterior = [],
  rotulo,
  formatValue,
}: {
  atual: number[];
  anterior?: number[];
  rotulo: string;
  formatValue: (v: number) => string;
}) {
  const w = 140;
  const h = 36;
  const pad = 4;
  const n = Math.max(atual.length, anterior.length);
  if (n < 2) return <div className="h-9" aria-hidden="true" />;
  const todos = [...atual, ...anterior, 0];
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const faixa = max - min || 1;
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / faixa) * (h - pad * 2);
  const caminho = (serie: number[]) =>
    serie.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const ultimo = atual.length - 1;
  const cruzaZero = min < 0 && max > 0;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-9 w-[140px] max-w-full shrink-0"
      role="img"
      aria-label={`${rotulo}, dia a dia neste mês`}
    >
      <title>{`${rotulo}: ${atual.map((v, i) => `dia ${i + 1} ${formatValue(v)}`).join(" · ")}`}</title>
      {cruzaZero && (
        <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="#e2e8f0" strokeWidth="1" />
      )}
      {anterior.length > 1 && (
        <path
          d={caminho(anterior)}
          fill="none"
          stroke={CINZA}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {atual.length > 1 && (
        <>
          <path
            d={caminho(atual)}
            fill="none"
            stroke={COBRE}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={x(ultimo)} cy={y(atual[ultimo])} r="3" fill={COBRE} stroke="#fff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

/* ---- a linha do saldo previsto ------------------------------------------ */

/**
 * O saldo previsto dia a dia. A linha do ZERO é desenhada sempre (é ela que a
 * lojista procura), o que fica abaixo dela ganha lavagem rosa, e só dois
 * pontos têm rótulo: o fim da linha e o dia mais apertado quando ele fica
 * negativo. Cada dia tem um alvo de toque largo com o valor dele.
 */
export function LinhaDeSaldo({
  pontos,
  formatValue,
  height = 230,
}: {
  pontos: PontoPrevisto[];
  formatValue: (v: number) => string;
  height?: number;
}) {
  const w = 640;
  const h = height;
  const pad = { top: 22, right: 16, bottom: 26, left: 64 };
  const n = pontos.length;
  if (n < 2) return null;
  const saldos = pontos.map((p) => p.saldo);
  const marcas = marcasDoEixo(Math.min(...saldos), Math.max(...saldos));
  const min = marcas[0];
  const max = marcas[marcas.length - 1];
  const faixa = max - min || 1;
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (i / (n - 1)) * iw;
  const y = (v: number) => pad.top + (1 - (v - min) / faixa) * ih;
  const linha = pontos
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.saldo).toFixed(1)}`)
    .join(" ");
  const y0 = y(0);
  const area = `${linha} L${x(n - 1).toFixed(1)},${y0.toFixed(1)} L${x(0).toFixed(1)},${y0.toFixed(1)} Z`;
  const maisBaixo = pontos.reduce((m, p, i) => (p.saldo < pontos[m].saldo ? i : m), 0);
  const fim = n - 1;
  const passoRotulo = Math.max(1, Math.ceil((n - 1) / 6));
  const idAcima = "saldo-acima-de-zero";
  const idAbaixo = "saldo-abaixo-de-zero";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-auto w-full"
      role="img"
      aria-label="Saldo previsto dia a dia"
    >
      <defs>
        <clipPath id={idAcima}>
          <rect x="0" y="0" width={w} height={Math.max(0, y0)} />
        </clipPath>
        <clipPath id={idAbaixo}>
          <rect x="0" y={y0} width={w} height={Math.max(0, h - y0)} />
        </clipPath>
      </defs>
      {marcas.map((m) => (
        <g key={m}>
          <line
            x1={pad.left}
            x2={w - pad.right}
            y1={y(m)}
            y2={y(m)}
            stroke={m === 0 ? "#94a3b8" : "#f1f5f9"}
            strokeWidth="1"
          />
          <text
            x={pad.left - 8}
            y={y(m) + 3.5}
            textAnchor="end"
            fontSize="10"
            className="fill-slate-400 tabular-nums"
          >
            {valorCurto(m)}
          </text>
        </g>
      ))}
      <path d={area} fill={COBRE} fillOpacity="0.1" clipPath={`url(#${idAcima})`} />
      <path d={area} fill={ROSA} fillOpacity="0.12" clipPath={`url(#${idAbaixo})`} />
      <path
        d={linha}
        fill="none"
        stroke={COBRE}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* alvos de toque: um por dia, largos, com o valor no title */}
      {pontos.map((p, i) => (
        <rect
          key={p.dia}
          x={x(i) - iw / (n - 1) / 2}
          y={pad.top}
          width={Math.max(iw / (n - 1), 6)}
          height={ih}
          fill="transparent"
        >
          <title>{`${formatarDia(p.dia)}: saldo ${formatValue(p.saldo)} · entra ${formatValue(p.entra)} · sai ${formatValue(p.sai)}`}</title>
        </rect>
      ))}
      {/* marcadores: começo, fim e o dia mais apertado (se negativo) */}
      <circle cx={x(0)} cy={y(pontos[0].saldo)} r="4" fill={COBRE} stroke="#fff" strokeWidth="2" />
      <circle cx={x(fim)} cy={y(pontos[fim].saldo)} r="4" fill={COBRE} stroke="#fff" strokeWidth="2" />
      <text
        x={Math.min(x(fim), w - pad.right - 4)}
        y={Math.max(y(pontos[fim].saldo) - 10, 12)}
        textAnchor="end"
        fontSize="11"
        fontWeight="600"
        className="fill-slate-700"
      >
        {formatValue(pontos[fim].saldo)}
      </text>
      {pontos[maisBaixo].saldo < 0 && maisBaixo !== fim && (
        <>
          <circle
            cx={x(maisBaixo)}
            cy={y(pontos[maisBaixo].saldo)}
            r="4"
            fill={ROSA}
            stroke="#fff"
            strokeWidth="2"
          />
          <text
            x={Math.min(Math.max(x(maisBaixo), pad.left + 40), w - pad.right - 40)}
            y={Math.min(y(pontos[maisBaixo].saldo) + 16, h - pad.bottom - 2)}
            textAnchor="middle"
            fontSize="11"
            fontWeight="600"
            className="fill-rose-700"
          >
            {formatValue(pontos[maisBaixo].saldo)} em {diaCurto(pontos[maisBaixo].dia)}
          </text>
        </>
      )}
      {pontos.map((p, i) =>
        i % passoRotulo === 0 || i === fim ? (
          <text
            key={`r-${p.dia}`}
            x={x(i)}
            y={h - 8}
            textAnchor={i === 0 ? "start" : i === fim ? "end" : "middle"}
            fontSize="10"
            className="fill-slate-400"
          >
            {i === 0 ? "hoje" : diaCurto(p.dia)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/* ---- o medidor da nota -------------------------------------------------- */

const COR_DO_TOM: Record<TomDaSaude, string> = {
  bom: "#059669",
  atencao: "#d97706",
  ruim: "#e11d48",
};

/** Meio arco de 0 a 100. O trilho é um passo mais claro da mesma família. */
export function Medidor({ nota, tom }: { nota: number; tom: TomDaSaude }) {
  const r = 40;
  const c = Math.PI * r; // meia circunferência
  const parte = Math.max(0, Math.min(100, nota)) / 100;
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 100 56" className="w-full" role="img" aria-label={`Nota ${nota} de 100`}>
        <path
          d={`M 10 50 A ${r} ${r} 0 0 1 90 50`}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d={`M 10 50 A ${r} ${r} 0 0 1 90 50`}
          fill="none"
          stroke={COR_DO_TOM[tom]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(parte * c).toFixed(2)} ${c.toFixed(2)}`}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <span className="text-4xl font-semibold leading-none text-slate-900">{nota}</span>
        <span className="text-sm text-slate-400">/100</span>
      </div>
    </div>
  );
}
