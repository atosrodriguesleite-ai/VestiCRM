"use client";

import { Printer } from "lucide-react";

/** Botão de imprimir da Declaração de Conteúdo (some na impressão). */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center gap-1.5 rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition"
    >
      <Printer className="size-4" />
      Imprimir
    </button>
  );
}
