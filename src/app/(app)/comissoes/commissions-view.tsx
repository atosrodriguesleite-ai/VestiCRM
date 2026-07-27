"use client";

/**
 * Comissões — cada vendedor tem seu % (editável pelo admin) sobre os
 * pedidos PAGOS no período. A base (produtos ou total) é escolhida pela
 * loja. Cálculo: comissão = base × % ÷ 100.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText } from "lucide-react";
import { brl } from "@/lib/format";
import { Card, Avatar } from "@/components/ui";

type Row = {
  id: string;
  name: string;
  color: string;
  rate: number;
  orders: number;
  base: number;
  commission: number;
  inactive?: boolean; // desligado, mas com comissão a receber do período
};

export function CommissionsView({
  rows,
  base,
  canEdit,
  de,
  ate,
  unassigned,
}: {
  rows: Row[];
  base: "SUBTOTAL" | "TOTAL";
  canEdit: boolean;
  de: string;
  ate: string;
  unassigned: { count: number; base: number };
}) {
  const router = useRouter();
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.id, String(r.rate)]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savingBase, setSavingBase] = useState(false);

  async function saveRate(id: string) {
    const rate = parseFloat((rates[id] ?? "0").replace(",", "."));
    if (Number.isNaN(rate) || rate < 0 || rate > 100) return;
    setSavingId(id);
    const res = await fetch(`/api/team/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionRate: rate }),
    });
    setSavingId(null);
    if (res.ok) {
      setSavedId(id);
      setTimeout(() => setSavedId(null), 1500);
      router.refresh();
    }
  }

  async function saveBase(newBase: string) {
    if (newBase === base) return;
    setSavingBase(true);
    await fetch("/api/company", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commissionBase: newBase }),
    });
    setSavingBase(false);
    router.refresh();
  }

  const liveCommission = (r: Row) => {
    const rate = parseFloat((rates[r.id] ?? "0").replace(",", ".")) || 0;
    return (r.base * rate) / 100;
  };

  const totalBase = rows.reduce((s, r) => s + r.base, 0);
  const totalCommission = rows.reduce((s, r) => s + liveCommission(r), 0);
  const inputCls = "rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300";

  return (
    <>
      {/* filtros de período + base */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-5">
        {/* no celular os filtros QUEBRAM linha: sem isso os dois campos de
            data + botão passavam da largura da tela e empurravam a página
            inteira para o lado (a tabela ia junto) */}
        <form className="flex flex-wrap items-end gap-2" method="GET">
          <div className="min-w-0 flex-1 sm:flex-none">
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">De</label>
            <input type="date" name="de" defaultValue={de} className={`${inputCls} w-full sm:w-auto`} />
          </div>
          <div className="min-w-0 flex-1 sm:flex-none">
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Até</label>
            <input type="date" name="ate" defaultValue={ate} className={`${inputCls} w-full sm:w-auto`} />
          </div>
          <button className="rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 transition">
            Filtrar
          </button>
        </form>
        <div className="sm:ml-auto">
          <label className="block text-[11px] font-semibold text-gray-500 mb-1">
            Comissão sobre
          </label>
          <select
            value={base}
            disabled={!canEdit || savingBase}
            onChange={(e) => saveBase(e.target.value)}
            className={`${inputCls} bg-white disabled:opacity-60`}
          >
            <option value="SUBTOTAL">Valor dos produtos</option>
            <option value="TOTAL">Total do pedido (com frete)</option>
          </select>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase bg-gray-50/70">
                <th className="px-4 py-3">Vendedor(a)</th>
                <th className="px-4 py-3 text-center">Pedidos pagos</th>
                <th className="px-4 py-3 text-right">Base</th>
                <th className="px-4 py-3 text-center">%</th>
                <th className="px-4 py-3 text-right">Comissão</th>
                <th className="px-4 py-3 text-center">Extrato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.name} color={r.color} size="sm" />
                      <span className="font-medium">{r.name}</span>
                      {r.inactive && (
                        <span
                          className="rounded-full bg-gray-100 text-gray-500 text-[10px] font-semibold px-1.5 py-0.5"
                          title="Vendedor desligado — a comissão do período continua devida"
                        >
                          desligado
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{r.orders}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{brl(r.base)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <input
                        value={rates[r.id] ?? ""}
                        onChange={(e) => setRates((p) => ({ ...p, [r.id]: e.target.value }))}
                        onBlur={() => canEdit && saveRate(r.id)}
                        disabled={!canEdit}
                        inputMode="decimal"
                        className={`${inputCls} w-16 text-center disabled:opacity-60`}
                      />
                      <span className="text-gray-400 text-xs">%</span>
                      {savedId === r.id && <Check className="size-3.5 text-emerald-500" />}
                      {savingId === r.id && <span className="text-[10px] text-gray-400">…</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600">
                    {brl(liveCommission(r))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {/* extrato em PDF do período filtrado: conferência pedido
                        a pedido antes de pagar (abre em outra aba) */}
                    <a
                      href={`/api/comissoes/relatorio?seller=${r.id}&de=${de}&ate=${ate}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-700 transition"
                      title={`Extrato de comissão de ${r.name} (PDF)`}
                    >
                      <FileText className="size-3.5" />
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">
                    Nenhum vendedor ativo.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100 font-semibold bg-gray-50/40">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-center tabular-nums">
                  {rows.reduce((s, r) => s + r.orders, 0)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(totalBase)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                  {brl(totalCommission)}
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {unassigned.count > 0 && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          <strong>{unassigned.count}</strong> pedido(s) pago(s) ({brl(unassigned.base)}) estão
          <strong> sem vendedor definido</strong> e não geram comissão. Abra cada pedido e
          escolha o vendedor responsável para incluí-los.
        </p>
      )}
      <p className="mt-3 text-xs text-gray-400">
        Só pedidos <strong>pagos</strong> contam (cancelado não gera comissão). O %
        de cada vendedor é editável acima e salvo automaticamente.
      </p>
    </>
  );
}
