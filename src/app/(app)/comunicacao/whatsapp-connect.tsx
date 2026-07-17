"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Conexão do WhatsApp da loja SEM API oficial (estilo WhatsApp Web):
 * termo de aceite obrigatório → QR Code → conectado. O estado é consultado
 * a cada poucos segundos enquanto o QR está na tela.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Power,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import { Card } from "@/components/ui";

type Estado = {
  serverConfigured: boolean;
  consent: { userName: string; acceptedAt: string } | null;
  termo: { texto: string; versao: string } | null;
  status: "DESCONECTADO" | "AGUARDANDO_QR" | "CONECTADO";
  phone: string | null;
  limites: { gapSegundos: number; tetoDiario: number; enviadosHoje: number };
};

export function WhatsappConnect({ canEdit }: { canEdit: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aceito, setAceito] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch("/api/whatsapp/evolution");
    if (res.ok) {
      const d: Estado = await res.json();
      setEstado(d);
      if (d.status === "CONECTADO") setQr(null);
      return d;
    }
    return null;
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // enquanto o QR está na tela, consulta o estado a cada 4s
  useEffect(() => {
    if (!qr) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(carregar, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [qr, carregar]);

  async function aceitarTermo() {
    setBusy(true);
    setErro("");
    const res = await fetch("/api/whatsapp/evolution/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aceito: true }),
    });
    setBusy(false);
    if (res.ok) carregar();
    else setErro((await res.json().catch(() => ({}))).error ?? "Não foi possível registrar o aceite.");
  }

  async function conectar() {
    setBusy(true);
    setErro("");
    const res = await fetch("/api/whatsapp/evolution/connect", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && d.qr) setQr(d.qr);
    else setErro(d.error ?? "Não foi possível gerar o QR Code.");
  }

  async function desconectar() {
    if (
      !window.confirm(
        "Desconectar o WhatsApp da loja? As mensagens novas deixam de entrar no sistema até conectar de novo."
      )
    )
      return;
    setBusy(true);
    await fetch("/api/whatsapp/evolution/disconnect", { method: "POST" });
    setQr(null);
    setBusy(false);
    carregar();
  }

  if (!estado) {
    return (
      <Card className="p-5 mb-5">
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" />
          Carregando conexão do WhatsApp…
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">
          <MessageCircle className="size-4 text-emerald-600" />
          WhatsApp da loja — conexão rápida (sem API oficial)
        </h2>
        {estado.status === "CONECTADO" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1">
            <CheckCircle2 className="size-3.5" />
            Conectado{estado.phone ? ` · ${estado.phone}` : ""}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Conecte o número da loja pelo QR Code (como o WhatsApp Web). As mensagens
        dos clientes viram leads no funil automaticamente, com vendedor
        distribuído e tarefa de atendimento — e as respostas saem daqui do
        sistema.
      </p>

      {!estado.serverConfigured ? (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm p-3">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          O servidor de conexão ainda não foi ativado pela plataforma. Assim que
          for, o botão de conectar aparece aqui — nada mais muda.
        </p>
      ) : !estado.consent ? (
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
            Termo de uso — leia antes de conectar
          </p>
          <pre className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-[12px] leading-relaxed text-gray-700 max-h-64 overflow-y-auto thin-scroll mb-3">
            {estado.termo?.texto}
          </pre>
          {canEdit ? (
            <>
              <label className="flex items-start gap-2 text-sm text-gray-700 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceito}
                  onChange={(e) => setAceito(e.target.checked)}
                  className="size-4 accent-emerald-600 mt-0.5"
                />
                Li e aceito o termo. Estou ciente de que a conexão não oficial
                pode resultar em bloqueio do número pela Meta, inclusive sem
                aviso prévio.
              </label>
              <button
                onClick={aceitarTermo}
                disabled={!aceito || busy}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50"
              >
                {busy ? "Registrando…" : "Aceitar e continuar"}
              </button>
            </>
          ) : (
            <p className="text-xs text-gray-400">
              Somente o administrador da loja pode aceitar o termo e conectar.
            </p>
          )}
        </div>
      ) : estado.status === "CONECTADO" ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">
            Enviadas hoje: <b>{estado.limites.enviadosHoje}</b> de{" "}
            {estado.limites.tetoDiario} (limite de segurança) · espaçamento de{" "}
            {estado.limites.gapSegundos}s entre envios · termo aceito por{" "}
            {estado.consent.userName}
          </p>
          {canEdit && (
            <button
              onClick={desconectar}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 hover:border-rose-300 hover:text-rose-600 text-gray-500 text-xs font-medium px-3 py-2 transition disabled:opacity-50"
            >
              <Power className="size-3.5" />
              Desconectar
            </button>
          )}
        </div>
      ) : (
        <div>
          {qr ? (
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <img
                src={qr}
                alt="QR Code de conexão do WhatsApp"
                className="size-52 rounded-xl border border-gray-200 bg-white p-2"
              />
              <ol className="text-sm text-gray-600 space-y-1.5">
                <li>1. Abra o <b>WhatsApp</b> no celular da loja</li>
                <li>2. Toque em <b>⋮ → Dispositivos conectados</b></li>
                <li>3. Toque em <b>Conectar dispositivo</b></li>
                <li>4. Aponte a câmera para este código</li>
                <li className="text-xs text-gray-400 pt-1">
                  <Loader2 className="inline size-3 animate-spin mr-1" />
                  Aguardando leitura… a tela atualiza sozinha.
                </li>
              </ol>
            </div>
          ) : (
            canEdit && (
              <button
                onClick={conectar}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-5 py-2.5 transition disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}
                {busy ? "Gerando QR Code…" : "Conectar WhatsApp (QR Code)"}
              </button>
            )
          )}
          <p className="text-[11px] text-gray-400 mt-3 leading-snug">
            💡 Recomendação: use um número <b>dedicado à loja</b> (não o
            pessoal). Número novo deve ser usado normalmente no aplicativo por
            1–2 semanas antes de conectar.
          </p>
        </div>
      )}
      {erro && (
        <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mt-3">{erro}</p>
      )}
    </Card>
  );
}
