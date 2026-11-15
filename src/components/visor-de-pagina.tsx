"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { useTravarFundo } from "@/components/travar-fundo";

/**
 * UMA PÁGINA PÚBLICA DO PRÓPRIO SISTEMA POR CIMA DA CONVERSA, COM X.
 *
 * Só para o aplicativo INSTALADO (`ondeAbrir` em `lib/links-do-texto.ts`):
 * lá, o link de rastreio ou de dados de envio que a vendedora toca abre
 * DENTRO do app, toma a tela e não tem botão de voltar — a armadilha do PDF
 * (`lib/documento-no-chat.ts`). Aqui a página fica numa moldura e o X, o Esc
 * e a barra do topo devolvem a conversa.
 *
 * A MOLDURA SÓ MOSTRA O PRÓPRIO SISTEMA (achado da revisão). Quem escolhe o
 * que entra é `ondeAbrir` (lista fechada de páginas públicas), mas uma
 * página pode REDIRECIONAR ou ter um link que leva para fora — e um site de
 * fora dentro de uma janela do sistema é o palco pronto para um "sua sessão
 * venceu, entre de novo" falso. Três trancas:
 *
 * - `sandbox` sem `allow-top-navigation`: nada de dentro troca a tela do app
 *   (seria a armadilha de volta); link de "abrir em outra aba" sai para o
 *   navegador do aparelho;
 * - a cada carga a moldura é conferida: se o endereço dela não é mais do
 *   sistema (o navegador nem deixa ler — é assim que se sabe), a moldura é
 *   TIRADA e fica o botão de abrir no navegador;
 * - a barra não exibe endereço nenhum como selo: diz o que é ("página
 *   aberta pela conversa").
 */
export function VisorDePagina({ href, onClose }: { href: string; onClose: () => void }) {
  useTravarFundo(true);
  const quadroRef = useRef<HTMLIFrameElement>(null);
  const [saiu, setSaiu] = useState(false);
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [onClose]);

  const conferir = () => {
    try {
      const onde = quadroRef.current?.contentWindow?.location;
      // página de fora: ler o endereço LANÇA erro; em branco ("about:") não conta
      if (!onde || (onde.origin !== window.location.origin && onde.protocol !== "about:")) {
        setSaiu(true);
      }
    } catch {
      setSaiu(true);
    }
  };

  return (
    <div
      data-visor-pagina
      className="fixed inset-0 z-[95] bg-black animate-fade-in flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-white shrink-0">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">Página aberta pela conversa</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="p-2.5 rounded-full bg-white/15 hover:bg-white/30 transition"
        >
          <X className="size-5" />
        </button>
      </div>
      {saiu ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
          <p className="text-sm max-w-xs" role="alert">
            Esta página leva para fora do sistema, então não abre aqui dentro.
          </p>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-xl bg-white text-ink text-sm font-medium px-4 py-2 transition hover:bg-white/90"
          >
            <ExternalLink className="size-4" />
            Abrir no navegador
          </a>
        </div>
      ) : (
        <iframe
          ref={quadroRef}
          src={href}
          onLoad={conferir}
          title="Página aberta pela conversa"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="flex-1 min-h-0 w-full bg-white"
        />
      )}
    </div>
  );
}
