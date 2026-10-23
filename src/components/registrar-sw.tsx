"use client";

import { useEffect } from "react";

/**
 * RN-095 · Registra o service worker para TODA a equipe logada.
 *
 * Até aqui ele só era registrado por quem ligava as notificações de venda
 * (Configurações), então a maioria dos aparelhos não tinha nenhum — e sem
 * service worker não há como trocar o branco do sistema pela página "Sem
 * conexão" quando a navegação não alcança o servidor (`public/sw.js`, que
 * traz essa página escrita nele). O registro é silencioso e nunca atrapalha
 * a tela: navegador sem suporte ou registro recusado seguem como sempre.
 *
 * Fica no layout da área logada, não no catálogo: a cliente final chega
 * pelo navegador de dentro do WhatsApp, que muitas vezes nem tem service
 * worker — lá quem segura a tela branca é só o vigia da abertura.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // sem registro, sem página de reserva — e nada mais muda
    });
  }, []);
  return null;
}
