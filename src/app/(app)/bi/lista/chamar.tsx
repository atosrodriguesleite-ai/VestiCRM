"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";

/**
 * CHAMAR NO WHATSAPP, a partir da lista do RFM (RN-093): abre (ou cria) a
 * conversa da cliente na Central e leva a mensagem do grupo JÁ NO CAMPO — o
 * mesmo caminho do "Recuperar venda" (`POST /api/conversations` e
 * `/whatsapp?conv=…&texto=`). A pessoa revisa e manda: nada sai sozinho
 * (RN-017), e a mensagem sai pelo número da loja, com registro na Central.
 */
export function Chamar({ customerId, mensagem }: { customerId: string; mensagem: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  async function chamar() {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setOcupado(false);
    if (res?.ok && d.id) {
      router.push(`/whatsapp?conv=${d.id}&texto=${encodeURIComponent(mensagem)}`);
    } else {
      setErro(d.error ?? "Não foi possível abrir a conversa. Tente de novo.");
    }
  }

  return (
    <div className="shrink-0 flex flex-col items-end">
      <button
        type="button"
        onClick={chamar}
        disabled={ocupado}
        title="Abre a conversa com a mensagem do grupo já no campo — você revisa e manda"
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
      >
        {ocupado ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}
        Chamar
      </button>
      {erro && <p className="text-[11px] text-rose-600 mt-1 max-w-48 text-right">{erro}</p>}
    </div>
  );
}
