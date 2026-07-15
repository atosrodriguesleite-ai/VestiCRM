"use client";

/**
 * Facilitador de instalação do PWA: no Android/Chrome mostra o botão nativo
 * "Instalar app"; no iPhone mostra o passo a passo (Compartilhar → Adicionar
 * à Tela de Início). Some quando o app já está instalado (tela cheia).
 */

import { useEffect, useState } from "react";
import {
  Smartphone,
  Share,
  PlusSquare,
  CheckCircle2,
  Download,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import { Card } from "@/components/ui";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppCard() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  // Chrome no iPhone: o Compartilhar fica NA BARRA DE ENDEREÇO (topo);
  // Safari: fica na barra de baixo. O guia aponta para o lugar certo.
  const [isCriOS, setIsCriOS] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari usa navigator.standalone
      (window.navigator as unknown as { standalone?: boolean }).standalone
    ) {
      setInstalled(true);
    }
    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));
    setIsCriOS(/crios/.test(ua));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
  }

  return (
    <Card className="p-5 mb-6">
      <h2 className="font-semibold flex items-center gap-2 mb-1">
        <Smartphone className="size-4 text-brand-600" />
        Instalar o app no celular
      </h2>

      {installed ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 mt-2">
          <CheckCircle2 className="size-4" />
          App instalado — você já está usando em tela cheia. 🎉
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mt-1 mb-3">
            Adicione o AtacadoPro à tela inicial e abra com <b>um toque</b>, em
            tela cheia, como um aplicativo — sem precisar digitar o endereço.
          </p>

          {deferred ? (
            <button
              onClick={install}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
            >
              <Download className="size-4" />
              Instalar app
            </button>
          ) : isIOS ? (
            <div className="space-y-2.5">
              <button
                onClick={() => setShowGuide(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 transition"
              >
                <Share className="size-4" />
                Me mostrar onde tocar
              </button>
              {/* IMPORTANTE: precisa ser o Compartilhar DO NAVEGADOR (barra de
                  endereço). A folha aberta por botão da página não traz a
                  opção "Adicionar à Tela de Início" no iOS. */}
              <ol className="text-sm text-gray-600 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="shrink-0 size-5 rounded-full bg-gray-100 text-[11px] font-bold flex items-center justify-center mt-0.5">
                    1
                  </span>
                  <span>
                    Toque no <b>Compartilhar</b>
                    <Share className="inline size-4 text-brand-600 mx-1 -mt-0.5" />
                    <b>do navegador</b> — o quadradinho com a setinha na barra do
                    endereço (Safari ou Chrome)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="shrink-0 size-5 rounded-full bg-gray-100 text-[11px] font-bold flex items-center justify-center mt-0.5">
                    2
                  </span>
                  <span>
                    <b>Role a lista até o fim</b> e toque em{" "}
                    <b>Adicionar à Tela de Início</b>
                    <PlusSquare className="inline size-4 text-brand-600 ml-1 -mt-0.5" />
                  </span>
                </li>
              </ol>
              <p className="text-[11px] text-gray-400 leading-snug">
                Não apareceu? Toque em &ldquo;Editar Ações&rdquo; no fim da lista e
                ative &ldquo;Adicionar à Tela de Início&rdquo; — ou abra este
                endereço no Safari e repita.
              </p>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              <p className="mb-1">
                No celular, abra este endereço pelo <b>Chrome</b> e:
              </p>
              <p className="flex items-center gap-2">
                Toque no menu <b>⋮</b> → <b>Instalar app</b> (ou “Adicionar à tela
                inicial”).
              </p>
            </div>
          )}
        </>
      )}

      {/* GUIA VISUAL (iPhone): escurece a tela e aponta a seta para o botão
          Compartilhar do navegador — Chrome (barra de endereço, topo) ou
          Safari (barra inferior). */}
      {showGuide && (
        <div
          className="fixed inset-0 z-[80] bg-black/75 flex flex-col items-center justify-center p-6"
          onClick={() => setShowGuide(false)}
        >
          {isCriOS ? (
            <div className="absolute top-2 right-4 flex flex-col items-center text-white animate-bounce">
              <ArrowUp className="size-10" />
              <p className="text-sm font-bold mt-1 text-center leading-tight">
                Toque no <br />
                Compartilhar ⬆️ aqui
              </p>
            </div>
          ) : (
            <div className="absolute bottom-6 inset-x-0 flex flex-col items-center text-white">
              <p className="text-sm font-bold mb-1 text-center leading-tight">
                Toque no Compartilhar ⬆️ aqui embaixo
              </p>
              <ArrowDown className="size-10 animate-bounce" />
            </div>
          )}

          <div
            className="bg-white rounded-2xl p-5 max-w-xs text-center shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-sm mb-2">
              1. Toque no botão <b>Compartilhar</b>{" "}
              <Share className="inline size-4 text-brand-600 -mt-0.5" /> do{" "}
              {isCriOS ? "Chrome (em cima, na barra do endereço)" : "Safari (embaixo)"}
            </p>
            <p className="font-semibold text-sm mb-3">
              2. <b>Role a lista até o fim</b> e toque em{" "}
              <span className="whitespace-nowrap">
                <b>Adicionar à Tela de Início</b>{" "}
                <PlusSquare className="inline size-4 text-brand-600 -mt-0.5" />
              </span>
            </p>
            <p className="text-[11px] text-gray-400 mb-3">
              Se não aparecer, toque em &ldquo;Editar Ações&rdquo; no fim da lista.
            </p>
            <button
              onClick={() => setShowGuide(false)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-sm font-medium px-4 py-2"
            >
              <X className="size-4" />
              Fechar
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
