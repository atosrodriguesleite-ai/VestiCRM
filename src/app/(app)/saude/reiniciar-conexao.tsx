"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import {
  CONFIRMACAO_DO_REINICIO,
  pedirReinicio,
  type ResultadoNaTela,
} from "@/lib/reinicio-da-conexao-tela";

/**
 * O botão da loja muda no painel de Saúde (RN-105): reinicia a conexão
 * daquela loja no servidor Evolution e reaplica os avisos, sem Hostinger.
 */
export function ReiniciarConexao({
  companyId,
  nome,
}: {
  companyId: string;
  nome: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<ResultadoNaTela | null>(null);

  async function reiniciar() {
    if (
      !window.confirm(
        `Reiniciar a conexão do WhatsApp da ${nome}? ${CONFIRMACAO_DO_REINICIO}`,
      )
    )
      return;
    setBusy(true);
    setResultado(null);
    const r = await pedirReinicio("/api/companies/whatsapp-reiniciar", { companyId });
    setResultado(r);
    setBusy(false);
    // o reinício pode ter gravado o estado novo: o cartão relê do servidor
    if (r.ok) router.refresh();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={reiniciar}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Reiniciando…" : "Reiniciar conexão"}
      </button>
      {resultado && (
        <p
          className={`text-xs ${resultado.ok ? "text-emerald-700" : "text-rose-600"}`}
          role="status"
        >
          {resultado.mensagem}
        </p>
      )}
    </div>
  );
}
