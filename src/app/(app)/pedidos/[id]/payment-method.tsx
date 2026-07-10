"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { paymentMethodLabel } from "@/lib/orders";
import type { PaymentMethod } from "@prisma/client";

/** Troca da forma de pagamento direto no card Pagamento. */
export function PaymentMethodChanger({
  orderId,
  current,
}: {
  orderId: string;
  current: PaymentMethod;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function change(method: string) {
    if (saving || method === current) return;
    setSaving(true);
    await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: method }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <select
      value={current}
      onChange={(e) => change(e.target.value)}
      disabled={saving}
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
