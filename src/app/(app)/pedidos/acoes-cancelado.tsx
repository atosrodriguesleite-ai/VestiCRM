"use client";

/**
 * AÇÕES DO PEDIDO CANCELADO na lista (pedido do dono, 07/10/2026): "esses
 * que já foram cancelados deveriam ter a opção de restaurar o pedido e ele
 * entrar como orçamento novamente, e um botão de fazer follow-up para tentar
 * recuperar a venda perdida".
 *
 * - RESTAURAR vai pela porta de sempre do pedido (PATCH status → ORÇAMENTO):
 *   é ela que volta a SEGURAR o estoque como pedido novo (RN-003) — e recusa,
 *   com frase, se a peça já foi vendida para outra cliente no meio. Cancelar
 *   de novo passa pelo diálogo de sempre (devolver ou baixar, RN-004).
 * - RECUPERAR abre a conversa da cliente na Central com a mensagem sugerida
 *   já no campo (o mesmo caminho do "Conversar" da Agenda): a vendedora lê,
 *   ajusta e manda. Nada sai sozinho.
 *
 * A linha inteira é um link para o pedido — os botões param a navegação.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { mensagemDeRecuperacao } from "@/lib/recuperar-venda";

export function AcoesDoCancelado({
  orderId,
  customerId,
  nomeDaCliente,
  numero,
  totalDePecas,
  pecas,
}: {
  orderId: string;
  customerId: string;
  nomeDaCliente: string;
  numero: string;
  totalDePecas: number;
  pecas: string[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<"restaurar" | "recuperar" | null>(null);
  const [erro, setErro] = useState("");

  function parar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function restaurar(e: React.MouseEvent) {
    parar(e);
    if (ocupado) return;
    setOcupado("restaurar");
    setErro("");
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ORCAMENTO" }),
    });
    setOcupado(null);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setErro(d?.error ?? "Não foi possível restaurar o pedido.");
      return;
    }
    router.refresh();
  }

  async function recuperar(e: React.MouseEvent) {
    parar(e);
    if (ocupado) return;
    setOcupado("recuperar");
    setErro("");
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
    const d = await res.json().catch(() => ({}));
    setOcupado(null);
    if (res.ok && d.id) {
      const mensagem = mensagemDeRecuperacao({ nomeDaCliente, numero, totalDePecas, pecas });
      router.push(`/whatsapp?conv=${d.id}&texto=${encodeURIComponent(mensagem)}`);
    } else {
      setErro(d.error ?? "Não foi possível abrir a conversa. Tente de novo.");
    }
  }

  return (
    <div className="mt-3 border-t border-dashed border-gray-100 pt-2.5" onClick={parar}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={restaurar}
          disabled={ocupado !== null}
          title="Volta o pedido para orçamento e segura o estoque de novo"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
        >
          {ocupado === "restaurar" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          Restaurar como orçamento
        </button>
        <button
          type="button"
          onClick={recuperar}
          disabled={ocupado !== null}
          title="Abre a conversa da cliente com uma mensagem pronta para tentar recuperar a venda"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {ocupado === "recuperar" ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
          Recuperar venda
        </button>
      </div>
      {erro && <p className="mt-1.5 text-xs font-medium text-rose-600">{erro}</p>}
    </div>
  );
}
