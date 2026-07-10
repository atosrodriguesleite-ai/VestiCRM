"use client";

/**
 * Dúvida sobre um número: ícone "?" que mostra a lógica do cálculo.
 * Desktop: aparece ao passar o mouse. Celular: aparece ao tocar.
 */

import { useState } from "react";
import { HelpCircle } from "lucide-react";

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Como é calculado"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-slate-300 hover:text-brand-500 transition"
      >
        <HelpCircle className="size-3.5" />
      </button>
      {open && (
        <>
          {/* fecha ao tocar fora (mobile) */}
          <span
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setOpen(false)}
          />
          <span
            role="tooltip"
            className="absolute right-0 top-5 z-50 w-56 rounded-xl bg-slate-900 text-white text-[11px] leading-relaxed font-normal normal-case tracking-normal px-3 py-2 shadow-pop"
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
