"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  QrCode,
  Loader2,
  Copy,
  CheckCircle2,
  Receipt,
  ExternalLink,
  RefreshCcw,
} from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";

/**
 * Painel "dinheiro" do pedido: cobrança Pix (Mercado Pago, confirma sozinha)
 * e emissão de NF-e (Bling). Só aparece o que a loja tem conectado.
 */
export function CobrancaNfe({
  orderId,
  total,
  isPaid,
  isCancelled,
  mpConnected,
  blingConnected,
  canNfe,
  nfe,
}: {
  orderId: string;
  total: number;
  isPaid: boolean;
  isCancelled: boolean;
  mpConnected: boolean;
  blingConnected: boolean;
  canNfe: boolean; // gerente/admin
  nfe: { status: string | null; number: string | null; url: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"pix" | "nfe" | "nfeStatus" | null>(null);
  const [erro, setErro] = useState("");
  const [pix, setPix] = useState<{ copiaECola: string; qrBase64: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!mpConnected && !blingConnected) return null;

  async function gerarPix() {
    setBusy("pix");
    setErro("");
    const res = await fetch(`/api/orders/${orderId}/pix`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) setPix({ copiaECola: d.copiaECola, qrBase64: d.qrBase64 || null });
    else setErro(d.error ?? "Não foi possível gerar a cobrança.");
  }

  async function copiar() {
    if (!pix) return;
    await navigator.clipboard.writeText(pix.copiaECola);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function emitirNfe() {
    if (
      !window.confirm(
        "Emitir a NF-e deste pedido via Bling? A nota vai para a Receita — confira antes os itens e o CPF/CNPJ do cliente."
      )
    )
      return;
    setBusy("nfe");
    setErro("");
    const res = await fetch(`/api/orders/${orderId}/nfe`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) router.refresh();
    else setErro(d.error ?? "Não foi possível emitir a nota.");
  }

  async function atualizarNfe() {
    setBusy("nfeStatus");
    await fetch(`/api/orders/${orderId}/nfe`).catch(() => {});
    setBusy(null);
    router.refresh();
  }

  return (
    <Card className="p-5 mb-4">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <QrCode className="size-4 text-sky-600" />
        Cobrança e Nota
      </h2>

      {/* Pix automático */}
      {mpConnected && !isCancelled && (
        <div className="mb-4">
          {isPaid ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" /> Pedido pago ✅
            </p>
          ) : pix ? (
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              {pix.qrBase64 && (
                <img
                  src={`data:image/png;base64,${pix.qrBase64}`}
                  alt="QR Code Pix"
                  className="size-40 rounded-xl border border-gray-200 bg-white p-1.5"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold mb-1">
                  Pix de {brl(total)} gerado — vale 24h
                </p>
                <p className="text-xs text-gray-500 mb-2">
                  O cliente paga e o pedido vira <b>Pago sozinho</b>. Envie o
                  código no WhatsApp:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-2 text-[11px]">
                    {pix.copiaECola}
                  </code>
                  <button
                    onClick={copiar}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-3 py-2"
                  >
                    {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={gerarPix}
              disabled={busy === "pix"}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
            >
              {busy === "pix" ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
              Cobrar {brl(total)} via Pix (confirma sozinho)
            </button>
          )}
        </div>
      )}

      {/* NF-e via Bling */}
      {blingConnected && canNfe && (
        <div className="border-t border-gray-100 pt-3">
          {nfe.status ? (
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <Receipt className="size-4 text-emerald-600" />
              <span className="font-semibold">
                NF-e{nfe.number ? ` nº ${nfe.number}` : ""}:
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  nfe.status === "AUTORIZADA"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : nfe.status === "REJEITADA" || nfe.status === "ERRO"
                      ? "bg-rose-50 text-rose-600 border border-rose-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}
              >
                {nfe.status}
              </span>
              {nfe.url && (
                <a
                  href={nfe.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                >
                  <ExternalLink className="size-3" /> ver DANFE
                </a>
              )}
              <button
                onClick={atualizarNfe}
                disabled={busy === "nfeStatus"}
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                title="Atualizar situação"
              >
                {busy === "nfeStatus" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCcw className="size-3" />
                )}
                atualizar
              </button>
            </div>
          ) : (
            <button
              onClick={emitirNfe}
              disabled={busy === "nfe"}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
            >
              {busy === "nfe" ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
              Emitir NF-e (Bling)
            </button>
          )}
        </div>
      )}

      {erro && (
        <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{erro}</p>
      )}
    </Card>
  );
}
