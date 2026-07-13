"use client";

/**
 * Ativa as notificações de venda (Web Push): registra o service worker, pede
 * permissão e inscreve o dispositivo. Quando um pedido vira PAGO, o celular
 * do lojista recebe um aviso — mesmo com o app fechado.
 * No iPhone, só funciona com o app adicionado à tela inicial (PWA).
 */

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State =
  | "loading"
  | "unsupported"
  | "needs-install-ios"
  | "unavailable" // chaves VAPID não configuradas no servidor
  | "off"
  | "blocked"
  | "on"
  | "working";

export function SaleNotifications() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported) {
        // iPhone fora do app instalado não tem PushManager
        const ua = navigator.userAgent.toLowerCase();
        const isIOS = /iphone|ipad|ipod/.test(ua);
        const standalone =
          window.matchMedia("(display-mode: standalone)").matches ||
          (window.navigator as unknown as { standalone?: boolean }).standalone;
        setState(isIOS && !standalone ? "needs-install-ios" : "unsupported");
        return;
      }
      // servidor tem as chaves?
      const keyRes = await fetch("/api/push/vapid");
      if (!keyRes.ok) {
        setState("unavailable");
        return;
      }
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("off"));
  }, []);

  async function enable() {
    setError("");
    setState("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        return;
      }
      const { key } = await fetch("/api/push/vapid").then((r) => r.json());
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error("save");
      setState("on");
    } catch {
      setError("Não foi possível ativar. Tente novamente.");
      setState("off");
    }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  return (
    <Card className="p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <BellRing className="size-4 text-brand-600" />
        Notificações de vendas no celular
      </h2>
      <p className="text-sm text-gray-500 mt-1 mb-3">
        Receba um aviso na tela do celular <b>toda vez que um pedido virar
        pago</b> — como as grandes plataformas de venda. 💰
      </p>

      {state === "loading" && (
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" /> Verificando...
        </p>
      )}

      {state === "on" && (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            Notificações <b>ativadas</b> neste aparelho.
          </p>
          <button
            onClick={disable}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-rose-500"
          >
            <BellOff className="size-3.5" />
            Desativar
          </button>
        </div>
      )}

      {(state === "off" || state === "working") && (
        <button
          onClick={enable}
          disabled={state === "working"}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition disabled:opacity-60"
        >
          {state === "working" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Bell className="size-4" />
          )}
          Ativar notificações
        </button>
      )}

      {state === "blocked" && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          As notificações estão <b>bloqueadas</b> nas configurações do navegador
          para este site. Libere a permissão de notificações e tente de novo.
        </p>
      )}

      {state === "needs-install-ios" && (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
          No iPhone, as notificações só funcionam com o app <b>instalado na tela
          inicial</b>. Instale o app acima (Compartilhar → Adicionar à Tela de
          Início), abra pelo ícone e volte aqui para ativar.
        </p>
      )}

      {state === "unavailable" && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
          Recurso ainda não configurado no servidor (chaves de notificação). Fale
          com o suporte para habilitar.
        </p>
      )}

      {state === "unsupported" && (
        <p className="text-sm text-gray-500">
          Este navegador não suporta notificações. Use o Chrome (Android) ou o
          app instalado (iPhone).
        </p>
      )}

      {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
    </Card>
  );
}
