"use client";

/**
 * Faixa de boas-vindas (uma vez) que convida a instalar o AtacadoPro na tela
 * inicial do celular. No Android mostra o botão nativo; no iPhone, o passo a
 * passo (Compartilhar → Adicionar à Tela de Início). Aparece só no celular,
 * quando o app ainda não está instalado, e some depois de dispensado.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X, Download, Share, PlusSquare } from "lucide-react";

const KEY = "ap_install_prompt_dismissed";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(KEY)) return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone;
    if (standalone) return; // já instalado

    const ua = navigator.userAgent.toLowerCase();
    const mobile = /android|iphone|ipad|ipod/.test(ua);
    if (!mobile) return; // convite é só para celular
    const ios = /iphone|ipad|ipod/.test(ua);
    setIsIOS(ios);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (ios) setShow(true); // iOS não dispara o evento; mostra instruções

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(KEY, "1");
    setShow(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    dismiss();
  }

  if (!show || typeof document === "undefined") return null;

  // Portal para o body: evita ancestrais com transform/overflow que quebram o
  // position:fixed. Fica ACIMA da barra de navegação inferior do celular.
  return createPortal(
    <div className="fixed inset-x-2 bottom-[76px] z-[60] md:hidden animate-fade-up">
      <div className="rounded-2xl bg-white shadow-pop border border-gray-100 p-4">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt="AtacadoPro"
            className="size-11 rounded-xl shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">Instale o AtacadoPro no celular</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Abra com um toque, em tela cheia — como um app. É grátis e não
              precisa de loja de apps.
            </p>

            {isIOS ? (
              <div className="mt-2.5 text-xs text-gray-600 space-y-1">
                <p className="flex items-center gap-1.5">
                  <span className="shrink-0 size-4 rounded-full bg-gray-100 text-[10px] font-bold flex items-center justify-center">
                    1
                  </span>
                  Toque em <b>Compartilhar</b>
                  <Share className="size-3.5 text-brand-600" />
                </p>
                <p className="flex items-center gap-1.5">
                  <span className="shrink-0 size-4 rounded-full bg-gray-100 text-[10px] font-bold flex items-center justify-center">
                    2
                  </span>
                  <b>Adicionar à Tela de Início</b>
                  <PlusSquare className="size-3.5 text-brand-600" />
                </p>
              </div>
            ) : deferred ? (
              <button
                onClick={install}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-2 transition"
              >
                <Download className="size-3.5" />
                Instalar agora
              </button>
            ) : (
              <p className="mt-2.5 text-xs text-gray-500">
                Abra pelo <b>Chrome</b> e toque em <b>⋮ → Instalar app</b>. Veja o
                passo a passo em{" "}
                <Link
                  href="/configuracoes"
                  onClick={dismiss}
                  className="text-brand-600 font-medium underline"
                >
                  Configurações
                </Link>
                .
              </p>
            )}
          </div>

          <button
            onClick={dismiss}
            aria-label="Agora não"
            className="text-gray-300 hover:text-gray-500 p-1 shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
