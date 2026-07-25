"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Power,
  QrCode,
  Receipt,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui";

/**
 * Conexões do dinheiro (tela Configurações):
 *  - Mercado Pago: cobranças Pix com confirmação automática do pedido
 *  - Bling: emissão de NF-e a partir do pedido
 */

type MpEstado = {
  platformReady: boolean;
  connected: boolean;
  connectedAt: string | null;
  feePercent: number;
};
type BlingEstado = {
  platformReady: boolean;
  connected: boolean;
  connectedAt: string | null;
};

export function MercadoPagoConnect() {
  const [estado, setEstado] = useState<MpEstado | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/mercadopago");
    if (res.ok) setEstado(await res.json());
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function desconectar() {
    if (
      !window.confirm(
        "Desconectar o Mercado Pago? Novas cobranças Pix deixam de funcionar até conectar de novo."
      )
    )
      return;
    setBusy(true);
    await fetch("/api/mercadopago/disconnect", { method: "POST" });
    setBusy(false);
    carregar();
  }

  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <QrCode className="size-4 text-sky-600" />
          Mercado Pago — Pix com confirmação automática
        </h2>
        {estado?.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1">
            <CheckCircle2 className="size-3.5" />
            Conectado
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-3">
        Gere a cobrança Pix direto no pedido: o cliente paga e o pedido vira{" "}
        <b>Pago sozinho</b> — estoque baixa, comissão conta e o celular apita 💰.
        O dinheiro cai na conta Mercado Pago <b>da loja</b>.
      </p>
      {!estado ? (
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      ) : !estado.platformReady ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm p-3">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          Pagamentos ainda não ativados pela plataforma. Assim que forem, o
          botão de conectar aparece aqui.
        </p>
      ) : estado.connected ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">
            Taxa da plataforma por cobrança: <b>{estado.feePercent}%</b> (já
            descontada automaticamente — sem boleto nem cobrança extra).
          </p>
          <button
            onClick={desconectar}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
          >
            <Power className="size-3.5" />
            Desconectar
          </button>
        </div>
      ) : (
        <a
          href="/api/mercadopago/connect"
          className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-5 py-2.5 transition"
        >
          <Wallet className="size-4" />
          Conectar Mercado Pago
        </a>
      )}
    </Card>
  );
}

export function BlingConnect() {
  const [estado, setEstado] = useState<BlingEstado | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/bling");
    if (res.ok) setEstado(await res.json());
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function desconectar() {
    if (!window.confirm("Desconectar o Bling? A emissão de NF-e para de funcionar até conectar de novo.")) return;
    setBusy(true);
    await fetch("/api/bling/disconnect", { method: "POST" });
    setBusy(false);
    carregar();
  }

  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <Receipt className="size-4 text-emerald-600" />
          Bling — Nota Fiscal (NF-e) do pedido
        </h2>
        {estado?.connected && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1">
            <CheckCircle2 className="size-3.5" />
            Conectado
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-3">
        Emita a NF-e direto da tela do pedido — o AtacadoPro monta a nota e o
        Bling (conta <b>da loja</b>) transmite à Receita. Requisito: cliente com
        CPF/CNPJ preenchido na ficha.
      </p>
      {!estado ? (
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </p>
      ) : !estado.platformReady ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm p-3">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          Integração Bling ainda não ativada pela plataforma. Assim que for, o
          botão de conectar aparece aqui.
        </p>
      ) : estado.connected ? (
        <div className="flex items-center justify-end">
          <button
            onClick={desconectar}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
          >
            <Power className="size-3.5" />
            Desconectar
          </button>
        </div>
      ) : (
        <a
          href="/api/bling/connect"
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2.5 transition"
        >
          <Receipt className="size-4" />
          Conectar Bling
        </a>
      )}
    </Card>
  );
}
