"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";

/**
 * VENDA A PRAZO (RN-069): a previsão de recebimento combinada com a cliente.
 *
 * Sem nada digitado vale o padrão (30 dias da entrega). A vendedora combina
 * uma data ("ela paga dia 20") e o vencimento da conta a receber passa a ser
 * esse dia — é a porta do pedido (PATCH) que grava, e o financeiro acompanha
 * pela porta única (RN-033). "Voltar aos 30 dias" tira a previsão.
 */
export function PrevisaoRecebimento({
  orderId,
  previsaoISO,
  padraoTexto,
  podeEditar,
}: {
  orderId: string;
  /** "AAAA-MM-DD" da previsão combinada, ou null (padrão) */
  previsaoISO: string | null;
  /** o vencimento padrão, já escrito ("04 de nov") */
  padraoTexto: string;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(previsaoISO ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gravar(previsao: string | null) {
    setSalvando(true);
    setErro(null);
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previsaoRecebimentoEm: previsao }),
    });
    const data = await res.json().catch(() => ({}));
    setSalvando(false);
    if (res.ok) {
      setEditando(false);
      setValor(previsao ?? ""); // "voltar aos 30 dias" não deixa a data velha no campo
      router.refresh();
    } else {
      setErro(data.error ?? "Não foi possível salvar.");
    }
  }

  const previsaoTexto = previsaoISO
    ? new Date(`${previsaoISO}T12:00:00Z`).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      })
    : null;

  if (!editando) {
    return (
      <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          Previsão de recebimento:{" "}
          <b>{previsaoTexto ?? padraoTexto}</b>{" "}
          <span className="text-orange-700/80">
            {previsaoTexto ? "(combinada com a cliente)" : "(padrão: 30 dias da entrega)"}
          </span>
        </span>
        {podeEditar && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="inline-flex items-center gap-1 rounded-full border border-orange-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-orange-800 hover:border-orange-500 transition"
          >
            <CalendarClock className="size-3" />
            {previsaoTexto ? "Mudar a data" : "Combinar uma data"}
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="mt-1.5 flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold text-orange-800" htmlFor="previsao-recebimento">
          Quando a cliente vai pagar?
        </label>
        <input
          id="previsao-recebimento"
          type="date"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="rounded-lg border border-orange-300 bg-white px-2 py-1 text-sm text-gray-800 outline-none focus:border-orange-500"
        />
        <button
          type="button"
          onClick={() => gravar(valor || null)}
          disabled={salvando || !valor}
          className="rounded-lg bg-orange-600 px-3 py-1 text-sm font-semibold text-white hover:bg-orange-700 transition disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        {previsaoISO && (
          <button
            type="button"
            onClick={() => gravar(null)}
            disabled={salvando}
            className="text-sm font-medium text-orange-800 underline-offset-2 hover:underline disabled:opacity-50"
          >
            Voltar aos 30 dias
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setEditando(false);
            setErro(null);
            setValor(previsaoISO ?? "");
          }}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancelar
        </button>
      </span>
      <span className="text-[11px] text-orange-700/80">
        A conta a receber no Financeiro passa a vencer nessa data. Sem data, vale o padrão de 30 dias.
      </span>
      {erro && <span className="text-xs font-medium text-rose-600">{erro}</span>}
    </span>
  );
}
