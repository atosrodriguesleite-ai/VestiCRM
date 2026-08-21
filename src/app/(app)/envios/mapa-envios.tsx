"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { Map as MapIcon } from "lucide-react";
import { NOME_DO_ESTADO } from "@/lib/envios/estados";
// import só de TIPO: some na compilação e NÃO puxa os ~170 KB de municípios
// do mapa.ts para o navegador
import type { MapaEnvios as MapaDeEnvios } from "@/lib/envios/mapa";
import mapaBrasil from "@/lib/envios/mapa-brasil.json";

export type { MapaDeEnvios };

/**
 * MAPA DE ENVIOS — o Brasil pintado por onde a loja vende.
 *
 * Estado fica mais forte quanto mais envios recebeu (escala do cobre da
 * marca); cada cidade de destino vira uma bolinha (a bolinha cresce com a
 * quantidade). Cidade que não casou com a base aparece no centro do estado —
 * o envio NUNCA some do mapa. Ao lado, a lista de estados com quantidade:
 * só entra estado com 1+ envio (estado sem envio não vira linha).
 *
 * Os contornos vêm de mapa-brasil.json (gerado por
 * scripts/gerar-mapa-envios.mjs, commitado — nada externo é consultado);
 * os pontos chegam prontos do servidor, já na projeção do viewBox.
 */

const UFS = (mapaBrasil as { viewBox: string; ufs: Record<string, { d: string; centro: number[] }> }).ufs;
const VIEW_BOX = (mapaBrasil as { viewBox: string }).viewBox;
// lado do viewBox ("0 0 620 620" → 620), para posicionar a dica em % —
// regenerar o mapa com outro tamanho não pode desalinhar o tooltip
const LADO = Number(VIEW_BOX.split(" ")[3]);

/** escala sequencial do cobre — mais envios, mais forte */
const TONS = ["#f5e7da", "#ebcdb2", "#dfab80", "#d28655", "#c4622d"];
const SEM_ENVIO = "#efe9e0";

const plural = (n: number) => `${n} envio${n === 1 ? "" : "s"}`;

export function MapaEnvios({ mapa }: { mapa: MapaDeEnvios }) {
  const [dica, setDica] = useState<{ x: number; y: number; titulo: string; texto: string } | null>(null);

  const contagem = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of mapa.porUf) m.set(e.uf, e.quantidade);
    return m;
  }, [mapa.porUf]);

  const maiorUf = mapa.porUf[0]?.quantidade ?? 0;
  const maiorPonto = mapa.pontos[0]?.quantidade ?? 0;

  const corDoEstado = (uf: string) => {
    const q = contagem.get(uf) ?? 0;
    if (q === 0 || maiorUf === 0) return SEM_ENVIO;
    return TONS[Math.min(TONS.length - 1, Math.floor((q / maiorUf) * TONS.length))];
  };
  const raioDoPonto = (q: number) =>
    maiorPonto <= 0 ? 5 : 4.5 + 7.5 * Math.sqrt(q / maiorPonto);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <MapIcon className="size-4 text-brand-600" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Mapa de envios</p>
          <p className="text-xs text-slate-400">
            para onde a loja vende — cada etiqueta comprada acende o destino
          </p>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
        {/* ---- o Brasil ------------------------------------------------ */}
        <div className="relative mx-auto w-full max-w-xl" onMouseLeave={() => setDica(null)}>
          <svg viewBox={VIEW_BOX} className="w-full" role="img" aria-label="Mapa do Brasil com a quantidade de envios por estado">
            {Object.entries(UFS).map(([uf, forma]) => (
              <path
                key={uf}
                d={forma.d}
                fill={corDoEstado(uf)}
                stroke="#fff"
                strokeWidth={1.2}
                className="transition-opacity hover:opacity-80"
                onMouseEnter={() =>
                  setDica({
                    x: forma.centro[0],
                    y: forma.centro[1],
                    titulo: NOME_DO_ESTADO[uf] ?? uf,
                    texto: plural(contagem.get(uf) ?? 0),
                  })
                }
              >
                <title>{`${NOME_DO_ESTADO[uf] ?? uf} — ${plural(contagem.get(uf) ?? 0)}`}</title>
              </path>
            ))}
            {/* bolinhas por cidade (as maiores por baixo, para nenhuma sumir) */}
            {mapa.pontos.map((p) => (
              <circle
                key={`${p.cidade ?? "~"}|${p.uf}`}
                cx={p.x}
                cy={p.y}
                r={raioDoPonto(p.quantidade)}
                fill="#7c3a18"
                fillOpacity={0.85}
                stroke="#fff"
                strokeWidth={2}
                onMouseEnter={() =>
                  setDica({
                    x: p.x,
                    y: p.y,
                    titulo: p.cidade ? `${p.cidade} · ${p.uf}` : `${p.uf} (cidade não identificada)`,
                    texto: plural(p.quantidade),
                  })
                }
              >
                <title>{`${p.cidade ?? p.uf} — ${plural(p.quantidade)}`}</title>
              </circle>
            ))}
          </svg>

          {dica && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-white shadow-lg"
              style={{ left: `${(dica.x / LADO) * 100}%`, top: `${(dica.y / LADO) * 100}%` }}
            >
              <p className="whitespace-nowrap text-xs font-medium">{dica.titulo}</p>
              <p className="whitespace-nowrap text-[11px] text-slate-300">{dica.texto}</p>
            </div>
          )}

          {/* legenda */}
          <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <span>menos</span>
            <span className="flex overflow-hidden rounded-sm">
              {TONS.map((t) => (
                <span key={t} className="h-2.5 w-6" style={{ backgroundColor: t }} />
              ))}
            </span>
            <span>mais</span>
            <span className="ms-3 inline-block size-2.5 rounded-full border border-white bg-[#7c3a18]" />
            <span>cidade da cliente</span>
          </div>
        </div>

        {/* ---- envios por estado (só quem tem 1+) ---------------------- */}
        {mapa.total === 0 ? (
          <div className="flex items-center justify-center p-4 text-center text-sm text-slate-400">
            Nenhum envio ainda — o mapa acende conforme as etiquetas saem. 🚚
          </div>
        ) : (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Envios por estado
            </p>
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pe-1 thin-scroll">
              {mapa.porUf.map((e) => (
                <li key={e.uf}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate text-slate-700">
                      <span className="me-1.5 font-semibold text-slate-500">{e.uf}</span>
                      {e.nome}
                    </span>
                    <span className="font-semibold tabular-nums text-slate-800">{e.quantidade}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-brand-600"
                      style={{ width: `${Math.max(6, (e.quantidade / maiorUf) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              {plural(mapa.total)} no total · {mapa.porUf.length} estado{mapa.porUf.length === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
