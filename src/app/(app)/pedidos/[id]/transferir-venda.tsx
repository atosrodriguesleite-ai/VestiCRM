"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check } from "lucide-react";

/**
 * Transferir a venda para outra vendedora, em poucos cliques, direto do
 * pedido. A regra de quem pode já foi decidida no servidor — aqui o botão
 * só aparece para quem pode, e a troca fica registrada no histórico.
 */
export function TransferirVenda({
  orderId,
  sellerId,
  sellers,
}: {
  orderId: string;
  sellerId: string | null;
  sellers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const opcoes = sellers.filter((s) => s.id !== sellerId);

  async function transferir() {
    if (!para || salvando) return;
    const nome = opcoes.find((o) => o.id === para)?.name ?? "";
    if (!window.confirm(`Transferir esta venda para ${nome}? A comissão vai junto.`))
      return;
    setSalvando(true);
    setErro("");
    const res = await fetch(`/api/orders/${orderId}/transferir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: para, motivo: motivo.trim() || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setSalvando(false);
    if (res.ok) {
      setOk(`Venda transferida para ${d.para ?? nome}.`);
      setAberto(false);
      setPara("");
      setMotivo("");
      router.refresh();
      setTimeout(() => setOk(""), 4000);
    } else {
      setErro(d.error ?? "Não foi possível transferir agora.");
    }
  }

  if (ok) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
        <Check className="size-4 shrink-0" />
        {ok}
      </p>
    );
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:border-brand-300 hover:text-brand-700"
      >
        <ArrowLeftRight className="size-4" />
        Transferir venda
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <p className="mb-2 text-[11px] font-semibold text-gray-500">
        Transferir esta venda para
      </p>
      <select
        value={para}
        onChange={(e) => setPara(e.target.value)}
        className="mb-2 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-brand-400"
      >
        <option value="">Escolha a vendedora…</option>
        {opcoes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo (opcional) — ex.: cliente da região dela"
        className="mb-2 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-brand-400"
      />
      <p className="mb-2 text-[11px] leading-snug text-gray-400">
        A comissão vai junto e a troca fica registrada no histórico do pedido.
      </p>
      <div className="flex gap-2">
        <button
          onClick={transferir}
          disabled={!para || salvando}
          className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {salvando ? "Transferindo…" : "Transferir"}
        </button>
        <button
          onClick={() => {
            setAberto(false);
            setErro("");
          }}
          className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
      {erro && <p className="mt-2 text-sm text-rose-600">{erro}</p>}
    </div>
  );
}
