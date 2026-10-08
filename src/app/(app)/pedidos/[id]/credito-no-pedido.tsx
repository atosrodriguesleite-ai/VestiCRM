"use client";

/**
 * RN-074 · O CRÉDITO DE TROCA DA CLIENTE NESTE PEDIDO — o aviso de que ela
 * tem crédito e o botão de usar (ou tirar). Quem decide é o servidor
 * (`lib/troca/credito-no-pedido`); a tela só mostra e pede.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { brl } from "@/lib/format";

export function CreditoNoPedido({
  orderId,
  saldoCliente,
  abatido,
  podeMexer,
  motivoBloqueio,
  valorVendido,
}: {
  orderId: string;
  /** o saldo da ficha HOJE (sem o que este pedido já usou) */
  saldoCliente: number;
  /** o que este pedido já abateu */
  abatido: number;
  /** status aceita e a pessoa é da equipe comercial */
  podeMexer: boolean;
  motivoBloqueio: string | null;
  /** o valor vendido de agora — zerado, o crédito já cobre o pedido inteiro */
  valorVendido: number;
}) {
  const router = useRouter();
  const [salvando, setSalvando] = useState<"usar" | "tirar" | null>(null);
  const [erro, setErro] = useState("");

  if (saldoCliente <= 0.005 && abatido <= 0.005) return null;

  async function mexer(acao: "usar" | "tirar") {
    setErro("");
    setSalvando(acao);
    try {
      const res = await fetch(`/api/orders/${orderId}/credito`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(d.error ?? "Não deu para mexer no crédito.");
        return;
      }
      router.refresh();
    } catch {
      setErro("Sem conexão — nada mudou. Tente de novo.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <Wallet className="size-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          {abatido > 0.005 && (
            <p className="text-emerald-800">
              <strong>{brl(abatido)}</strong> de crédito de troca abatido neste pedido.
            </p>
          )}
          {saldoCliente > 0.005 && (
            <p className="text-emerald-800">
              A cliente tem <strong>{brl(saldoCliente)}</strong> de crédito de troca na ficha.
            </p>
          )}
          {!podeMexer && motivoBloqueio && <p className="text-[11px] text-gray-500">{motivoBloqueio}</p>}
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>
        {podeMexer && (
          <div className="flex flex-col gap-1.5 shrink-0">
            {saldoCliente > 0.005 && valorVendido > 0.005 && (
              <button
                onClick={() => mexer("usar")}
                disabled={salvando !== null}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-2.5 py-1.5 transition disabled:opacity-60"
              >
                {salvando === "usar" && <Loader2 className="size-3 animate-spin" />}
                Usar neste pedido
              </button>
            )}
            {abatido > 0.005 && (
              <button
                onClick={() => mexer("tirar")}
                disabled={salvando !== null}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-300 text-emerald-800 text-xs font-medium px-2.5 py-1.5 hover:bg-emerald-100 transition disabled:opacity-60"
              >
                {salvando === "tirar" && <Loader2 className="size-3 animate-spin" />}
                Tirar o crédito
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
