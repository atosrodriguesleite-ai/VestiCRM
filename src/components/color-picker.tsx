"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pipette } from "lucide-react";
import { readableOn } from "@/lib/color";
import { CARTELA, HEX, normalizarHex } from "@/lib/paleta";

/**
 * ESCOLHER A COR — do jeito de quem trabalha com roupa, não com código.
 *
 * Antes havia só o quadradinho do navegador: sem rótulo, sem pista de que
 * era clicável, e abrindo um seletor técnico (matiz, saturação, RGB). A
 * lojista simplesmente não achava onde escolher a cor.
 *
 * Aqui ela tem os três caminhos, na ordem em que a cabeça funciona:
 *  1. cartela pronta com as tonalidades que a moda usa (um toque e pronto);
 *  2. o código exato (#A1B2C3), para quem tem o manual da marca na mão;
 *  3. o seletor completo do aparelho, para quem quer garimpar o tom.
 */

export function ColorPicker({
  value,
  onChange,
  onPickName,
  label = "Cor",
}: {
  value: string;
  onChange: (hex: string) => void;
  /** avisa o nome do tom escolhido na cartela (preenche o campo de nome) */
  onPickName?: (nome: string) => void;
  label?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [codigo, setCodigo] = useState(value);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => setCodigo(value), [value]);

  // clicar fora fecha (sem isso o painel fica preso na tela do celular)
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function escolher(hex: string, nome?: string) {
    onChange(hex);
    if (nome) onPickName?.(nome);
  }

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-sm font-medium text-gray-700 transition hover:border-brand-300"
        title="Escolher a cor"
      >
        <span
          className="size-6 rounded-lg border border-black/10 shadow-inner"
          style={{ background: value }}
        />
        <span className="text-xs">{label}</span>
        <Pipette className="size-3.5 text-gray-400" />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-2 w-[19rem] max-w-[86vw] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl animate-fade-in">
          {CARTELA.map((g) => (
            <div key={g.grupo} className="mb-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                {g.grupo}
              </p>
              <div className="grid grid-cols-9 gap-1.5">
                {g.tons.map(([nome, hex]) => (
                  <button
                    key={hex}
                    type="button"
                    title={nome}
                    onClick={() => escolher(hex, nome)}
                    className="relative aspect-square rounded-lg border border-black/10 transition hover:scale-110"
                    style={{ background: hex }}
                  >
                    {value.toUpperCase() === hex.toUpperCase() && (
                      <Check
                        className="absolute inset-0 m-auto size-3.5"
                        style={{ color: readableOn(hex) }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-1 border-t border-gray-100 pt-3">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Cor exata
            </p>
            <div className="flex items-center gap-2">
              <input
                value={codigo}
                onChange={(e) => {
                  setCodigo(e.target.value);
                  const hex = normalizarHex(e.target.value);
                  if (hex) onChange(hex);
                }}
                placeholder="#C94F7C"
                className="w-28 rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-brand-400"
              />
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2 text-xs font-medium text-gray-600 hover:border-brand-300">
                <span
                  className="size-4 rounded border border-black/10"
                  style={{ background: value }}
                />
                Mais tons
                <input
                  type="color"
                  value={HEX.test(value) ? value : "#C94F7C"}
                  onChange={(e) => onChange(e.target.value.toUpperCase())}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="ml-auto rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700"
              >
                Pronto
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              Tem o código da cor da sua marca? Cole aqui (ex.: #C94F7C).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
