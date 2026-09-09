"use client";

import Link from "next/link";
import { BarChart3, ClipboardList, Scissors, SlidersHorizontal } from "lucide-react";

export type AbaDoEstoque = "inventario" | "painel" | "minimos" | "producao";

const ABAS: { id: AbaDoEstoque; rotulo: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "inventario", rotulo: "Inventário", icon: ClipboardList },
  { id: "painel", rotulo: "Painel", icon: BarChart3 },
  { id: "minimos", rotulo: "Mínimos", icon: SlidersHorizontal },
  { id: "producao", rotulo: "Produção", icon: Scissors },
];

/** As abas do Estoque — links de verdade (a URL diz onde a pessoa está). */
export function Abas({
  ativa,
  temProducao,
  veAnalise,
}: {
  ativa: AbaDoEstoque;
  temProducao: boolean;
  veAnalise: boolean;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto thin-scroll border-b border-slate-200">
      {ABAS.filter((a) => (a.id !== "producao" || temProducao) && (a.id !== "painel" || veAnalise)).map((a) => {
        const on = a.id === ativa;
        return (
          <Link
            key={a.id}
            href={a.id === "inventario" ? "/estoque" : `/estoque?aba=${a.id}`}
            aria-current={on ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              on
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
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
