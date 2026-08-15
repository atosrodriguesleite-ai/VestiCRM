"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  ORDER_STATUS_FLOW,
  orderStatusLabel,
  orderStatusColor,
} from "@/lib/orders";
import type { OrderStatus } from "@prisma/client";
import { CancelOrderDialog } from "../cancel-dialog";

/**
 * Trilha de status clicável — muda o status do pedido com um toque.
 * Otimista: a trilha atualiza NA HORA do clique; o servidor confirma em
 * seguida. Se algo impedir (ex.: sem vendedor, sem estoque), o status
 * volta ao anterior e o motivo aparece em vermelho.
 */
export function StatusChanger({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderStatus;
}) {
  const router = useRouter();
  // estado otimista: reflete o clique imediatamente e re-sincroniza quando
  // o servidor devolve a página atualizada
  const [shown, setShown] = useState<OrderStatus>(current);
  useEffect(() => setShown(current), [current]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // cancelamento pergunta antes: devolver as peças ao estoque ou baixar de vez?
  const [askCancel, setAskCancel] = useState(false);
  const currentIdx = ORDER_STATUS_FLOW.indexOf(shown);

  async function setStatus(status: OrderStatus, restock?: boolean) {
    if (busy || status === shown) return;
    if (status === "CANCELADO" && restock === undefined) {
      setAskCancel(true); // a resposta do diálogo chama de novo com restock
      return;
    }
    const previous = shown;
    setShown(status); // resposta visual imediata
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(restock !== undefined ? { restock } : {}) }),
    });
    setBusy(false);
    if (!res.ok) {
      setShown(previous); // volta ao que era e mostra o motivo
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Não foi possível mudar o status. Tente de novo.");
      return;
    }
    router.refresh();
  }

  const cancelled = shown === "CANCELADO";

  return (
    // min-w-0: sem isso a régua de status (que rola na horizontal) empurra o
    // cartão inteiro e a TELA DO PEDIDO fica mais larga que o celular — dá
    // para arrastar a página para o lado, e o conteúdo sai da área visível.
    <div className="min-w-0">
      <div className="flex gap-1.5 overflow-x-auto thin-scroll pb-1">
        {ORDER_STATUS_FLOW.map((s, i) => {
          const active = s === shown;
          const done = !cancelled && i < currentIdx && s !== "CANCELADO";
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              disabled={busy}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition disabled:opacity-60 ${
                active
                  ? "text-white"
                  : done
                    ? "bg-emerald-50 text-emerald-600"
                    : cancelled && s !== "CANCELADO"
                      ? "bg-gray-50 text-gray-300"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
              style={active ? { backgroundColor: orderStatusColor[s] } : undefined}
            >
              {done && <Check className="size-3" />}
              {orderStatusLabel[s]}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <CancelOrderDialog
        open={askCancel}
        onClose={() => setAskCancel(false)}
        onConfirm={(restock) => {
          setAskCancel(false);
          setStatus("CANCELADO", restock);
        }}
      />
    </div>
  );
}
