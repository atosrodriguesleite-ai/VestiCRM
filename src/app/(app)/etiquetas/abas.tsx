"use client";

import Link from "next/link";
import { LayoutTemplate, Printer } from "lucide-react";

export type AbaDeEtiquetas = "modelos" | "imprimir";

const ABAS: { id: AbaDeEtiquetas; rotulo: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "modelos", rotulo: "Modelos", icon: LayoutTemplate },
  { id: "imprimir", rotulo: "Imprimir", icon: Printer },
];

/** As abas da área Etiquetas — links de verdade (a URL diz onde a pessoa está). */
export function Abas({ ativa }: { ativa: AbaDeEtiquetas }) {
  return (
    <nav className="flex gap-1 overflow-x-auto thin-scroll border-b border-slate-200 mb-4">
      {ABAS.map((a) => {
        const on = a.id === ativa;
        return (
          <Link
            key={a.id}
            href={a.id === "modelos" ? "/etiquetas" : `/etiquetas?aba=${a.id}`}
            aria-current={on ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              on ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
            }`}
          >
            <a.icon className="size-4" />
            {a.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
