"use client";

import { useEffect } from "react";
import { PackageCheck, PackageX, X } from "lucide-react";
import { Portal } from "@/components/portal";

/**
 * Pergunta feita ao cancelar um pedido: as peças voltam ao estoque?
 *
 *   • "Devolver ao estoque" → comportamento clássico (restock: true)
 *   • "Não devolver"        → baixa definitiva (restock: false), para peça
 *                             perdida, com defeito ou dada de brinde
 *
 * Substitui o antigo window.confirm — que só sabia perguntar sim/não e
 * sempre devolvia as peças.
 */
export function CancelOrderDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (restock: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Portal: o diálogo é usado também DENTRO da linha-link da lista de
    // pedidos — renderizado no <body>, o clique nos botões não navega a linha.
    <Portal>
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-order-title"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      />
      <div className="relative w-full rounded-t-3xl bg-white p-5 shadow-pop animate-scale-in sm:max-w-md sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="cancel-order-title"
              className="text-[17px] font-semibold text-slate-900"
            >
              Cancelar o pedido
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              O que fazer com as peças deste pedido?
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          <button
            onClick={() => onConfirm(true)}
            className="flex w-full items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <PackageCheck className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">
                Devolver ao estoque
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">
                As peças voltam ao catálogo e podem ser vendidas para outra
                cliente. É o caso normal.
              </span>
            </span>
          </button>

          <button
            onClick={() => onConfirm(false)}
            className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 p-4 text-left transition hover:border-rose-200 hover:bg-rose-50/40"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
              <PackageX className="size-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">
                Não devolver — baixa definitiva
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">
                As peças NÃO voltam ao estoque (perda, defeito, brinde…). A
                decisão fica registrada no histórico do pedido.
              </span>
            </span>
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
        >
          Voltar sem cancelar
        </button>
      </div>
    </div>
    </Portal>
  );
}
