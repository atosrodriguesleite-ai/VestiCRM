"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageDown, Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Traz as fotos de perfil do WhatsApp das clientes para a Central — a mesma
 * cara do aplicativo. O sistema já faz isso sozinho de tempos em tempos;
 * este botão é para ver na hora, logo depois de conectar o número.
 */
export function FotosClientes({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function buscar() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/whatsapp/fotos", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(d.error ?? "Não foi possível buscar as fotos agora.");
      return;
    }
    setMsg(
      d.conferidas > 0
        ? `Pronto! ${d.comFoto} foto(s) atualizada(s) em ${d.conferidas} cliente(s) conferida(s). Quem esconde a foto no WhatsApp continua com as iniciais.`
        : "Nenhuma cliente pendente — as fotos já estão em dia. 🎉"
    );
    router.refresh();
  }

  if (!connected) return null;

  return (
    <Card className="p-5 mb-5">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <ImageDown className="size-4 text-brand-600" />
        Fotos das clientes
      </h2>
      <p className="text-sm text-gray-500 mb-3">
        Traz a <b>foto de perfil do WhatsApp</b> de cada cliente para a Central
        de Atendimento e para o cadastro — igual ao aplicativo. O sistema
        atualiza sozinho de tempos em tempos; use o botão para ver na hora.
        Quem esconde a foto no WhatsApp continua com as iniciais coloridas.
      </p>
      {msg ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
          <CheckCircle2 className="size-4 shrink-0" />
          {msg}
        </p>
      ) : (
        <button
          onClick={buscar}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}
          {busy ? "Buscando fotos…" : "Buscar fotos agora"}
        </button>
      )}
    </Card>
  );
}
