"use client";

/**
 * Monitor de estoque baixo: lista as variações (cor/tamanho) de produtos
 * ativos que chegaram ao limite definido pela loja. O dono ajusta o limite
 * aqui mesmo — salvo na hora e refletido no card do Dashboard.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown } from "lucide-react";

export type LowStockRow = {
  product: string;
  color: string;
  size: string;
  stock: number;
};

export function StockMonitor({
  rows,
  threshold,
  canManage,
}: {
  rows: LowStockRow[];
  threshold: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveThreshold(value: string) {
    const n = Math.max(0, parseInt(value) || 0);
    if (n === threshold) return;
    setSaving(true);
    await fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lowStockThreshold: n }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div
      className={`rounded-2xl border mb-5 ${
        rows.length > 0
          ? "border-amber-200 bg-amber-50/70"
          : "border-emerald-100 bg-emerald-50/50"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <AlertTriangle
          className={`size-4 shrink-0 ${rows.length > 0 ? "text-amber-500" : "text-emerald-500"}`}
        />
        <button
          onClick={() => rows.length > 0 && setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium flex-1 min-w-0 text-left"
        >
          {rows.length > 0 ? (
            <>
              <span className="text-amber-800">
                {rows.length} variaç{rows.length === 1 ? "ão" : "ões"} com
                estoque baixo
              </span>
              <ChevronDown
                className={`size-4 text-amber-500 transition ${open ? "rotate-180" : ""}`}
              />
            </>
          ) : (
            <span className="text-emerald-700">
              Estoque saudável — nenhuma variação no limite
            </span>
          )}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
          Avisar quando restar
          {canManage ? (
            <input
              defaultValue={threshold}
              onBlur={(e) => saveThreshold(e.target.value)}
              disabled={saving}
              inputMode="numeric"
              className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-xs text-center bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:opacity-60"
            />
          ) : (
            <b>{threshold}</b>
          )}
          peça{threshold === 1 ? "" : "s"} ou menos
        </label>
      </div>
      {open && rows.length > 0 && (
        <div className="px-4 pb-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg bg-white border border-amber-100 px-3 py-1.5 text-xs"
              >
                <span className="truncate">
                  <b>{r.product}</b> · {r.color} {r.size}
                </span>
                <span
                  className={`font-semibold tabular-nums shrink-0 ${r.stock === 0 ? "text-rose-600" : "text-amber-600"}`}
                >
                  {r.stock === 0 ? "esgotado" : `${r.stock} un.`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
