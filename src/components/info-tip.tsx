"use client";

/**
 * Dúvida sobre um número: ícone "?" que mostra a lógica do cálculo.
 * Desktop: aparece ao passar o mouse. Celular: aparece ao tocar.
 * O balão calcula a própria posição e NUNCA vaza pra fora da tela
 * (cards da coluna esquerda cortavam o texto no celular).
 */

import { useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

const LARGURA = 224; // w-56

export function InfoTip({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function abrir() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // preferência: alinhado à direita do ícone; sempre preso à área visível
    const left = Math.min(
      Math.max(8, r.right - LARGURA),
      Math.max(8, window.innerWidth - LARGURA - 8)
    );
    setPos({ top: r.bottom + 6, left });
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        aria-label="Como é calculado"
        // toque SEMPRE abre (celulares disparam hover+clique juntos — alternar
        // fazia abrir e fechar no mesmo toque); fecha tocando fora da dica
        onClick={(e) => {
          e.stopPropagation();
          abrir();
        }}
        onMouseEnter={abrir}
        onMouseLeave={() => setPos(null)}
        className="text-slate-300 hover:text-brand-500 transition"
      >
        <HelpCircle className="size-3.5" />
      </button>
      {pos && (
        <>
          {/* fecha ao tocar fora (mobile) */}
          <span
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setPos(null)}
          />
          <span
            role="tooltip"
            className="fixed z-50 w-56 rounded-xl bg-slate-900 text-white text-[11px] leading-relaxed font-normal normal-case tracking-normal px-3 py-2 shadow-pop"
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
