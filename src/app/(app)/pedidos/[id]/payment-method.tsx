"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { paymentMethodLabel } from "@/lib/orders";
import type { PaymentMethod } from "@prisma/client";

/**
 * Troca da forma de pagamento direto no card Pagamento.
 * Otimista: o valor muda na hora; o servidor confirma em seguida.
 */
export function PaymentMethodChanger({
  orderId,
  current,
}: {
  orderId: string;
  current: PaymentMethod;
}) {
  const router = useRouter();
  const [shown, setShown] = useState<string>(current);
  useEffect(() => setShown(current), [current]);

  async function change(method: string) {
    if (method === shown) return;
    setShown(method); // resposta visual imediata
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: method }),
    });
    if (!res.ok) setShown(current);
    else router.refresh();
  }

  return (
    <select
      value={shown}
      onChange={(e) => change(e.target.value)}
      className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:opacity-60"
    >
      {Object.entries(paymentMethodLabel).map(([value, text]) => (
        <option key={value} value={value}>
          {text}
        </option>
      ))}
    </select>
  );
}
