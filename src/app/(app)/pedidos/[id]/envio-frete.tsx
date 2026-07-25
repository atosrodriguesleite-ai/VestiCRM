"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  Loader2,
  Copy,
  CheckCircle2,
  Printer,
  FileText,
  XCircle,
  RefreshCcw,
  MessageCircle,
} from "lucide-react";
import { Card } from "@/components/ui";
import { brl } from "@/lib/format";

/**
 * Painel de Envio do pedido (módulo Envios / Melhor Envio):
 * cotar → escolher serviço → comprar etiqueta → imprimir + rastrear.
 * Só aparece para loja com o módulo ligado e o Melhor Envio conectado.
 */

type Quote = {
  serviceId: number;
  service: string;
  carrier: string;
  carrierLogo: string | null;
  price: number;
  days: number | null;
};

type Ship = {
  meOrderId: string | null;
  meService: string | null;
  meCarrier: string | null;
  mePrice: number | null;
  meStatus: string | null;
  labelUrl: string | null;
  trackingCode: string | null;
  weightKg: number | null;
} | null;

const statusLabel: Record<string, string> = {
  ETIQUETA: "Etiqueta pronta para imprimir",
  POSTADO: "Postado — a caminho 🚚",
  ENTREGUE: "Entregue ✅",
  CANCELADO: "Etiqueta cancelada",
};

export function EnvioFrete({
  orderId,
  customerName,
  hasZip,
  canBuy,
  isCancelled,
  initialShipping,
}: {
  orderId: string;
  customerName: string;
  hasZip: boolean;
  canBuy: boolean;
  isCancelled: boolean;
  initialShipping: Ship;
}) {
  const router = useRouter();
  const [ship, setShip] = useState<Ship>(initialShipping);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [busy, setBusy] = useState<"cotar" | "comprar" | "cancelar" | "rastreio" | "etiqueta" | null>(null);
  const [erro, setErro] = useState("");
  const [copied, setCopied] = useState<"code" | "msg" | null>(null);

  const comprado = Boolean(ship?.meOrderId && ship.meStatus !== "CANCELADO");

  async function acao(body: Record<string, unknown>) {
    const res = await fetch(`/api/orders/${orderId}/frete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, d };
  }

  async function cotar() {
    setBusy("cotar");
    setErro("");
    const { ok, d } = await acao({ action: "cotar" });
    setBusy(null);
    if (!ok) return setErro(d.error ?? "Não foi possível cotar o frete.");
    setQuotes(d.quotes);
    setWeightKg(d.weightKg ?? null);
    setEscolhido(d.quotes?.[0]?.serviceId ?? null);
  }

  async function comprar() {
    const q = quotes?.find((x) => x.serviceId === escolhido);
    if (!q) return;
    if (
      !window.confirm(
        `Comprar a etiqueta ${q.carrier} ${q.service} por ${brl(q.price)}? O valor sai do saldo da carteira Melhor Envio da loja.`
      )
    )
      return;
    setBusy("comprar");
    setErro("");
    const { ok, d } = await acao({
      action: "comprar",
      serviceId: q.serviceId,
      service: q.service,
      carrier: q.carrier,
    });
    setBusy(null);
    if (!ok) return setErro(d.error ?? "Não foi possível comprar a etiqueta.");
    setShip(d.shipping);
    setQuotes(null);
    router.refresh();
  }

  async function cancelar() {
    if (
      !window.confirm(
        "Cancelar esta etiqueta? Só funciona antes de postar a caixa — o valor volta para a carteira Melhor Envio."
      )
    )
      return;
    setBusy("cancelar");
    setErro("");
    const { ok, d } = await acao({ action: "cancelar" });
    setBusy(null);
    if (!ok) return setErro(d.error ?? "Não foi possível cancelar.");
    setShip(d.shipping);
    router.refresh();
  }

  async function abrirEtiqueta() {
    // o link do ME expira; pede um novo na hora de imprimir
    setBusy("etiqueta");
    setErro("");
    const { ok, d } = await acao({ action: "etiqueta" });
    setBusy(null);
    if (!ok) return setErro(d.error ?? "Não foi possível abrir a etiqueta.");
    window.open(d.url, "_blank", "noopener");
  }

  async function atualizarRastreio() {
    setBusy("rastreio");
    const res = await fetch(`/api/orders/${orderId}/frete`);
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok && d.shipping) {
      setShip(d.shipping);
      router.refresh();
    }
  }

  async function copiarCodigo() {
    if (!ship?.trackingCode) return;
    await navigator.clipboard.writeText(ship.trackingCode);
    setCopied("code");
    setTimeout(() => setCopied(null), 2000);
  }

  async function copiarMensagem() {
    if (!ship?.trackingCode) return;
    const msg =
      `Oi ${customerName.split(" ")[0]}! 📦 Seu pedido já está com a transportadora.\n\n` +
      `Código de rastreio: ${ship.trackingCode}\n` +
      `Acompanhe aqui: https://melhorrastreio.com.br/rastreio/${ship.trackingCode}\n\n` +
      `Qualquer coisa é só chamar! 💛`;
    await navigator.clipboard.writeText(msg);
    setCopied("msg");
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <Card className="p-5 mb-4">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <Truck className="size-4 text-orange-600" />
        Envio (Melhor Envio)
      </h2>

      {comprado ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold">
              {ship?.meCarrier} {ship?.meService}
            </span>
            {ship?.mePrice != null && (
              <span className="text-gray-500">— etiqueta {brl(ship.mePrice)}</span>
            )}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                ship?.meStatus === "ENTREGUE"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : ship?.meStatus === "POSTADO"
                    ? "bg-sky-50 text-sky-700 border-sky-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {statusLabel[ship?.meStatus ?? ""] ?? ship?.meStatus}
            </span>
            <button
              onClick={atualizarRastreio}
              disabled={busy === "rastreio"}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              title="Atualizar situação"
            >
              {busy === "rastreio" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCcw className="size-3" />
              )}
              atualizar
            </button>
          </div>

          {ship?.trackingCode ? (
            <div className="flex items-center gap-2 flex-wrap">
              <code className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-xs font-semibold tracking-wide">
                {ship.trackingCode}
              </code>
              <button
                onClick={copiarCodigo}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 hover:border-gray-300 text-gray-600 text-xs font-medium px-2.5 py-1.5"
              >
                {copied === "code" ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                {copied === "code" ? "Copiado!" : "Copiar código"}
              </button>
              <button
                onClick={copiarMensagem}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-2.5 py-1.5"
              >
                {copied === "msg" ? <CheckCircle2 className="size-3.5" /> : <MessageCircle className="size-3.5" />}
                {copied === "msg" ? "Copiado!" : "Copiar msg p/ WhatsApp"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">
              O código de rastreio aparece minutos depois da compra — clique em
              &quot;atualizar&quot;.
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={abrirEtiqueta}
              disabled={busy === "etiqueta"}
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
            >
              {busy === "etiqueta" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Imprimir etiqueta
            </button>
            <a
              href={`/declaracao/${orderId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
            >
              <FileText className="size-4" />
              Declaração de conteúdo
            </a>
            {canBuy && ship?.meStatus === "ETIQUETA" && (
              <button
                onClick={cancelar}
                disabled={busy === "cancelar"}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
              >
                {busy === "cancelar" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                Cancelar etiqueta
              </button>
            )}
          </div>
        </div>
      ) : isCancelled ? (
        <p className="text-sm text-gray-400">Pedido cancelado — sem envio.</p>
      ) : !hasZip ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          Preencha o <b>endereço com CEP</b> no cadastro do cliente para cotar o
          frete.
        </p>
      ) : quotes ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Cotação para <b>{weightKg} kg</b> (peso das peças + caixa padrão da
            loja). Escolha o serviço:
          </p>
          {quotes.map((q) => (
            <label
              key={q.serviceId}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                escolhido === q.serviceId
                  ? "border-orange-400 bg-orange-50/60"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="frete"
                checked={escolhido === q.serviceId}
                onChange={() => setEscolhido(q.serviceId)}
                className="accent-orange-600"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {q.carrierLogo && (
                <img src={q.carrierLogo} alt={q.carrier} className="h-5 w-auto" />
              )}
              <span className="flex-1 min-w-0 text-sm">
                <b>{q.carrier}</b> {q.service}
                {q.days != null && (
                  <span className="text-gray-400"> · até {q.days} dias úteis</span>
                )}
              </span>
              <span className="text-sm font-semibold tabular-nums">{brl(q.price)}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 pt-1">
            {canBuy ? (
              <button
                onClick={comprar}
                disabled={busy === "comprar" || !escolhido}
                className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
              >
                {busy === "comprar" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                Comprar etiqueta
              </button>
            ) : (
              <p className="text-xs text-gray-400">
                Peça a um gerente ou admin para comprar a etiqueta.
              </p>
            )}
            <button
              onClick={cotar}
              disabled={busy === "cotar"}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              <RefreshCcw className="size-3" /> cotar de novo
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={cotar}
          disabled={busy === "cotar"}
          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-50"
        >
          {busy === "cotar" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
          Cotar frete (Correios e transportadoras)
        </button>
      )}

      {erro && (
        <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{erro}</p>
      )}
    </Card>
  );
}
