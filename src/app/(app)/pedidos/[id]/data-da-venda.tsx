"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";

/**
 * "Criado em ..." com o botão do CASO À PARTE: editar a data da venda
 * (lançamento retroativo). No dia a dia ninguém digita data — o pedido nasce
 * com data e hora automáticas; o lápis existe para a venda do mês passado
 * que ficou sem lançar. Só gerente/admin veem o botão (a regra vale no
 * servidor também) e toda mudança fica na história do pedido.
 */
export function DataDaVenda({
  orderId,
  createdAt,
  pago,
  sellerName,
  podeEditar,
}: {
  orderId: string;
  createdAt: string; // ISO
  pago: boolean;
  sellerName: string | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(() => {
    // datetime-local quer "YYYY-MM-DDTHH:mm" no horário local do aparelho
    const d = new Date(createdAt);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const d = new Date(createdAt);
  const dataTexto = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const horaTexto = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/orders/${orderId}/data-da-venda`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quando: new Date(valor).toISOString() }),
    });
    const data = await res.json().catch(() => ({}));
    setSalvando(false);
    if (res.ok) {
      setEditando(false);
      router.refresh();
    } else {
      setErro(data.error ?? "Não foi possível salvar.");
    }
  }

  if (!editando) {
    return (
      <p className="text-sm text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
        <span>
          Criado em {dataTexto} às {horaTexto}
          {sellerName ? ` · Vendedor(a): ${sellerName}` : ""}
        </span>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            title="Editar a data da venda (lançamento retroativo)"
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-500 hover:border-brand-300 hover:text-brand-600 transition"
          >
            <CalendarClock className="size-3" />
            Editar data
          </button>
        )}
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 max-w-md">
      <p className="text-xs font-semibold text-amber-800 mb-1">
        🗓️ Lançamento retroativo — a venda passa a contar no mês da data escolhida
      </p>
      <p className="text-[11px] text-amber-700/80 mb-2">
        {pago
          ? "Vou ajustar a data de criação e de pagamento juntas, e registrar a mudança na história do pedido."
          : "Pedido ainda não pago: ajusto só a criação. Para o faturamento entrar no mês certo, marque como Pago e edite a data de novo."}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="datetime-local"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 transition disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditando(false);
            setErro(null);
          }}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancelar
        </button>
      </div>
      {erro && <p className="mt-1.5 text-xs text-rose-600">{erro}</p>}
    </div>
  );
}
