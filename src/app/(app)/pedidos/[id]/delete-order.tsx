"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/**
 * Excluir pedido de vez — para limpar testes.
 * Desfaz tudo (devolve estoque, tira a venda do faturamento) e some da
 * lista, como se o pedido nunca tivesse existido. Ação sem volta, por
 * isso pede confirmação. Só aparece para dono/admin/gerente.
 */
export function DeleteOrder({ orderId, number }: { orderId: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (
      !window.confirm(
        `Excluir o pedido ${number} para sempre?\n\n` +
          "Tudo que ele causou volta ao normal: o estoque retorna ao catálogo " +
          "e a venda sai do faturamento. Isso NÃO pode ser desfeito."
      )
    )
      return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Não foi possível excluir. Tente de novo.");
      setBusy(false);
      return;
    }
    router.push("/pedidos");
    router.refresh();
  }

  return (
    <div>
      <button
        onClick={remove}
        disabled={busy}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-medium px-4 py-2.5 transition disabled:opacity-60 w-full"
      >
        <Trash2 className="size-4" />
        {busy ? "Excluindo…" : "Excluir pedido"}
      </button>
      {error && (
        <p className="mt-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
