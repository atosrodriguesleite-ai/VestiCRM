"use client";

import { Printer } from "lucide-react";

export function PrintBar({ termica, id }: { termica: boolean; id: string }) {
  return (
    <div className="no-print flex items-center gap-2 mb-4">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 transition"
      >
        <Printer className="size-4" />
        Imprimir
      </button>
      <a
        href={termica ? `/etiqueta/lote/${id}` : `/etiqueta/lote/${id}?f=termica`}
        className="text-sm text-gray-500 underline underline-offset-2"
      >
        mudar pra {termica ? "A4" : "térmica 10×15"}
      </a>
    </div>
  );
}
