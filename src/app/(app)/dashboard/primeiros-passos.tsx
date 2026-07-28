import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";

/**
 * Checklist "Primeiros passos" — o caminho da loja nova até a primeira venda.
 *
 * Por que existe: até então a loja recém-criada caía num painel com todas as
 * métricas zeradas e nenhuma instrução do que fazer. Este card mostra os 4
 * passos na ordem certa e **some sozinho** quando todos estão concluídos —
 * quem já opera nunca mais o vê.
 */

export type Passo = {
  done: boolean;
  label: string; // o que fazer, em linguagem de lojista
  hint: string; // por que isso importa
  href: string;
};

export function PrimeirosPassos({ passos }: { passos: Passo[] }) {
  const feitos = passos.filter((p) => p.done).length;
  // completou tudo → o card desaparece de vez
  if (feitos === passos.length) return null;

  // próximo passo pendente ganha destaque (é o único CTA colorido)
  const proximo = passos.findIndex((p) => !p.done);

  return (
    <div className="rounded-2xl border border-brand-200 bg-white overflow-hidden mb-6">
      <div className="px-4 py-3 bg-brand-50 border-b border-brand-100 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-800">
            Primeiros passos
          </p>
          <p className="text-xs text-brand-700/70">
            Complete para começar a vender — depois este quadro some sozinho.
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-brand-700 bg-white border border-brand-200 rounded-full px-2.5 py-1">
          {feitos} de {passos.length}
        </span>
      </div>

      <ul className="divide-y divide-gray-50">
        {passos.map((p, i) => (
          <li key={p.href + p.label}>
            <Link
              href={p.href}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition group"
            >
              <span
                className={`shrink-0 size-6 rounded-full flex items-center justify-center border ${
                  p.done
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "bg-white border-gray-200 text-gray-300"
                }`}
              >
                {p.done ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  <span className="text-[11px] font-bold">{i + 1}</span>
                )}
              </span>

              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    p.done ? "text-gray-400 line-through" : "text-gray-800"
                  }`}
                >
                  {p.label}
                </p>
                {!p.done && (
                  <p className="text-xs text-gray-400 truncate">{p.hint}</p>
                )}
              </div>

              {!p.done && i === proximo && (
                <span className="shrink-0 hidden sm:inline text-xs font-semibold text-white bg-brand-600 group-hover:bg-brand-700 rounded-lg px-3 py-1.5 transition">
                  Fazer agora
                </span>
              )}
              {!p.done && (
                <ChevronRight className="shrink-0 size-4 text-gray-300" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
