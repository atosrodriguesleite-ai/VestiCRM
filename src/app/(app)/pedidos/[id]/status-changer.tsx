"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  ORDER_STATUS_FLOW,
  orderStatusLabel,
  orderStatusColor,
} from "@/lib/orders";
import type { OrderStatus } from "@prisma/client";

/**
 * Trilha de status clicável — muda o status do pedido com um toque.
 * Pode pular direto para qualquer etapa: o sistema executa a lógica
 * completa (confirma pagamento, baixa estoque, marca envio/entrega).
 * Se algo impedir (ex.: estoque insuficiente), o motivo aparece aqui.
 */
export function StatusChanger({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  const [error, setError] = useState("");
  const currentIdx = ORDER_STATUS_FLOW.indexOf(current);

  async function setStatus(status: OrderStatus) {
    if (busy || status === current) return;
    if (
      status === "CANCELADO" &&
      !window.confirm(
        "Cancelar o pedido? Se ele já estava pago, o estoque volta para o catálogo."
      )
    )
      return;
    setBusy(status);
    setError("");
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Não foi possível mudar o status. Tente de novo.");
      return;
    }
    router.refresh();
  }

  const cancelled = current === "CANCELADO";

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto thin-scroll pb-1">
        {ORDER_STATUS_FLOW.map((s, i) => {
          const active = s === current;
          const done = !cancelled && i < currentIdx && s !== "CANCELADO";
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              disabled={!!busy}
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
              {busy === s ? "Salvando…" : orderStatusLabel[s]}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
