"use client";

import Link from "next/link";
import { Gauge, Users } from "lucide-react";

export type AbaDoBi = "painel" | "vendedoras";

const ABAS: { id: AbaDoBi; rotulo: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "painel", rotulo: "Painel", icon: Gauge },
  { id: "vendedoras", rotulo: "Vendedoras", icon: Users },
];

/** As abas do BI — links de verdade (a URL diz onde a pessoa está), levando o período junto. */
export function Abas({ ativa, de, ate }: { ativa: AbaDoBi; de?: string; ate?: string }) {
  const periodo = [de ? `de=${de}` : "", ate ? `ate=${ate}` : ""].filter(Boolean);
  const href = (id: AbaDoBi) => {
    const params = [...(id === "painel" ? [] : [`aba=${id}`]), ...periodo];
    return params.length ? `/bi?${params.join("&")}` : "/bi";
  };
  return (
    <nav className="flex gap-1 overflow-x-auto thin-scroll border-b border-slate-200 mb-4">
      {ABAS.map((a) => {
        const on = a.id === ativa;
        return (
          <Link
            key={a.id}
            href={href(a.id)}
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
