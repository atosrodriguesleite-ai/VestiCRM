"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Loader2 } from "lucide-react";

/**
 * "Conversar no sistema" — abre o atendimento DENTRO da Central.
 *
 * É o caminho que a lojista procurava: achar a cliente no cadastro e falar
 * com ela sem sair do AtacadoPro. Assim o atendimento nasce no nome de quem
 * abriu (não vai para a fila, que é lugar de cliente esperando), cada
 * mensagem fica com o nome de quem escreveu e o histórico não se perde.
 */
export function AbrirConversa({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState("");

  async function abrir() {
    setIndo(true);
    setErro("");
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        setIndo(false);
        setErro(data.error ?? "Não consegui abrir a conversa. Tente de novo.");
        return;
      }
      router.push(`/whatsapp?conv=${data.id}`);
    } catch {
      setIndo(false);
      setErro("Sem conexão. Tente de novo.");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={abrir}
        disabled={indo}
        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm font-medium px-4 py-2.5 transition"
      >
        {indo ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MessageCircle className="size-4" />
        )}
        Conversar no WhatsApp
      </button>
      {erro && <span className="text-[11px] text-rose-600">{erro}</span>}
    </div>
  );
}
