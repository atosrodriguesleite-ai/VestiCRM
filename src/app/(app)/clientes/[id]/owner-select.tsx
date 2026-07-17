"use client";

/**
 * Distribuição MANUAL: troca o vendedor responsável pelo cliente direto na
 * ficha. Salva sozinho ao escolher (PATCH /api/customers/[id]).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OwnerSelect({
  customerId,
  ownerId,
  sellers,
}: {
  customerId: string;
  ownerId: string | null;
  sellers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(ownerId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "erro">("idle");

  async function change(next: string) {
    setValue(next);
    setState("saving");
    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerId: next || null }),
    });
    setState(res.ok ? "saved" : "erro");
    if (res.ok) {
      setTimeout(() => setState("idle"), 1800);
      router.refresh();
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium bg-white outline-none focus:border-brand-400 transition"
      >
        <option value="">Sem responsável</option>
        {sellers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {state === "saving" && <span className="text-[11px] text-gray-400">salvando…</span>}
      {state === "saved" && <span className="text-[11px] text-emerald-600">salvo ✓</span>}
      {state === "erro" && <span className="text-[11px] text-rose-600">não salvou</span>}
    </span>
  );
}
