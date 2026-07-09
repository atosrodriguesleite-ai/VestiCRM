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

/** Trilha de status clicável — muda o status do pedido com um toque. */
export function StatusChanger({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto thin-scroll pb-1">
      {ORDER_STATUS_FLOW.map((s, i) => {
        const active = s === current;
        const done = i < currentIdx && s !== "CANCELADO" && current !== "CANCELADO";
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
  );
}
