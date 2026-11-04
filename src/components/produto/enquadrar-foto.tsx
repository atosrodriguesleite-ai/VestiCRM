"use client";

import { useEffect, useRef, useState } from "react";
import { Crop, X } from "lucide-react";
import { Portal } from "@/components/portal";
import { ImagemEnquadrada } from "@/components/imagem-enquadrada";
import {
  comZoom,
  encaixar,
  enquadramentoInicial,
  limitesDaLargura,
  mover,
  type Enquadramento,
} from "@/lib/enquadramento";

/**
 * EDITOR DE ENQUADRAMENTO (RN-107): a foto inteira com a moldura 3:4 do card
 * por cima. Arrasta para mover a janela, o controle de zoom aproxima ou
 * afasta (o centro fica no lugar), e a prévia ao lado é o card de verdade —
 * o mesmo componente que o catálogo usa, então o que se vê aqui é o que a
 * cliente vê.
 *
 * Nada é recortado: o editor só devolve os quatro números da janela. "Tirar
 * enquadramento" volta ao corte de sempre (topo, centrado).
 *
 * A janela mora em FRAÇÕES da foto, e a foto é desenhada no tamanho que
 * couber — por isso a moldura é posicionada em porcentagem do quadro da
 * foto, e o arrasto converte pixels em fração pela medida do quadro. Sem
 * `--kb`: aqui não há campo de texto, o teclado não abre.
 */
export function EnquadrarFoto({
  src,
  enquadramento,
  onSalvar,
  onFechar,
}: {
  src: string;
  enquadramento: Enquadramento | null;
  onSalvar: (e: Enquadramento | null) => void;
  onFechar: () => void;
}) {
  // as medidas REAIS da foto: a régua trabalha com elas (a proporção da
  // janela é em pixels da foto, não da tela)
  const [medidas, setMedidas] = useState<{ w: number; h: number } | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [janela, setJanela] = useState<Enquadramento | null>(enquadramento);
  const quadro = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ x: number; y: number; janela: Enquadramento } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!(w > 0 && h > 0)) {
        setFalhou(true);
        return;
      }
      setMedidas({ w, h });
      // a janela gravada é re-encaixada (a foto pode ter mudado); sem janela,
      // começa do que o card mostra hoje
      setJanela((j) => (j ? encaixar(j, w, h) : enquadramentoInicial(w, h)));
    };
    img.onerror = () => setFalhou(true);
    img.src = src;
  }, [src]);

  const pronto = medidas && janela;

  // o zoom como um número de 0 (a maior janela) a 100 (a menor) — é o
  // controle deslizante; a janela é refeita a partir dele pelo centro
  const { minW, maxW } = medidas ? limitesDaLargura(medidas.w, medidas.h) : { minW: 1, maxW: 1 };
  const zoomAtual = pronto && maxW > minW ? Math.round(((maxW - janela.w) / (maxW - minW)) * 100) : 0;

  function mudarZoom(valor: number) {
    if (!pronto) return;
    const alvoW = maxW - ((maxW - minW) * valor) / 100;
    setJanela(comZoom(janela, alvoW / janela.w, medidas.w, medidas.h));
  }

  function comecarArrasto(e: React.PointerEvent<HTMLDivElement>) {
    if (!pronto) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrasto.current = { x: e.clientX, y: e.clientY, janela };
  }

  function arrastar(e: React.PointerEvent<HTMLDivElement>) {
    if (!pronto || !arrasto.current || !quadro.current) return;
    const r = quadro.current.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const dx = (e.clientX - arrasto.current.x) / r.width;
    const dy = (e.clientY - arrasto.current.y) / r.height;
    setJanela(mover(arrasto.current.janela, dx, dy, medidas.w, medidas.h));
  }

  function soltar() {
    arrasto.current = null;
  }

  const pct = (v: number) => `${v * 100}%`;

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onFechar} />
        <div className="relative bg-white rounded-t-2xl md:rounded-2xl shadow-pop w-full md:max-w-2xl max-h-[calc(100dvh_-_1.5rem)] overflow-y-auto thin-scroll p-5 animate-fade-up">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-base flex items-center gap-2">
              <Crop className="size-4 text-brand-600" /> Enquadrar a foto
            </h3>
            <button type="button" onClick={onFechar} className="text-gray-400 p-1" aria-label="Fechar">
              <X className="size-5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Arraste a moldura para escolher o que aparece no card do catálogo. A foto
            continua inteira na ficha da peça — só o card e o PDF usam a moldura.
          </p>

          {falhou && (
            <p className="text-sm text-rose-600 mb-3">Não deu para abrir esta foto para enquadrar.</p>
          )}

          <div className="grid md:grid-cols-[1fr_140px] gap-4 items-start">
            <div className="flex justify-center bg-gray-100 rounded-xl p-2">
              <div
                ref={quadro}
                className="relative inline-block select-none touch-none max-w-full"
                style={{ lineHeight: 0 }}
                onPointerDown={comecarArrasto}
                onPointerMove={arrastar}
                onPointerUp={soltar}
                onPointerCancel={soltar}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="max-w-full max-h-[55dvh] w-auto h-auto block"
                  style={{ pointerEvents: "none" }}
                />
                {pronto && (
                  <div
                    data-moldura
                    className="absolute border-2 border-white rounded-sm cursor-move"
                    style={{
                      left: pct(janela.x),
                      top: pct(janela.y),
                      width: pct(janela.w),
                      height: pct(janela.h),
                      // o que fica fora da moldura escurece — a sombra enorme é
                      // o jeito mais barato de pintar "tudo menos a janela"
                      boxShadow: "0 0 0 9999px rgba(0,0,0,.45)",
                    }}
                  />
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-medium text-gray-500 mb-1">Como fica no card</p>
                {pronto && (
                  <ImagemEnquadrada
                    src={src}
                    enquadramento={janela}
                    quadroClassName="w-[120px] rounded-xl border border-gray-200 bg-gray-50"
                    alt=""
                  />
                )}
              </div>
              <label className="block">
                <span className="text-[11px] font-medium text-gray-500">Zoom</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={zoomAtual}
                  disabled={!pronto || maxW <= minW}
                  onChange={(e) => mudarZoom(Number(e.target.value))}
                  className="w-full accent-brand-600"
                  aria-label="Zoom da moldura"
                />
              </label>
              <button
                type="button"
                disabled={!medidas}
                onClick={() => medidas && setJanela(enquadramentoInicial(medidas.w, medidas.h))}
                className="w-full text-xs font-medium rounded-lg border border-gray-200 px-2 py-1.5 hover:bg-gray-50 transition"
              >
                Centralizar
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 justify-end mt-4">
            {enquadramento && (
              <button
                type="button"
                onClick={() => onSalvar(null)}
                className="text-xs font-medium rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-50 transition"
              >
                Tirar enquadramento
              </button>
            )}
            <button
              type="button"
              onClick={onFechar}
              className="text-sm font-medium rounded-xl border border-gray-200 px-4 py-2 hover:bg-gray-50 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!pronto}
              onClick={() => pronto && onSalvar(janela)}
              className="text-sm font-semibold rounded-xl bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition disabled:opacity-50"
            >
              Usar este enquadramento
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
