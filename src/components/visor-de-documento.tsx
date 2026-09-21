"use client";

import { useEffect } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { linkParaSalvar } from "@/lib/midia-arquivo";
import { useTravarFundo } from "@/components/travar-fundo";

/**
 * VISOR DE PDF POR CIMA DA CONVERSA — irmão do visor de foto.
 *
 * Existe porque, no aplicativo instalado, abrir o PDF "em outra aba" não
 * abre aba nenhuma: o documento toma a tela do app e não há como voltar
 * (`lib/documento-no-chat.ts`). Aqui o PDF fica numa moldura DENTRO da
 * Central, e o X, o Esc e o toque no fundo fecham — a conversa nunca sai
 * de baixo. "Salvar" entrega como arquivo (`?baixar=1`, com nome) e
 * "Abrir fora" segue existindo para quem prefere o leitor do sistema.
 *
 * O quadro rola no próprio contêiner: no iPhone a moldura de PDF não rola
 * sozinha, mas cresce até o tamanho do documento quando o contêiner de fora
 * é quem rola (`-webkit-overflow-scrolling`).
 */
export function VisorDeDocumento({
  src,
  nome,
  onClose,
}: {
  src: string;
  nome: string;
  onClose: () => void;
}) {
  useTravarFundo(true);
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [onClose]);

  return (
    <div
      data-visor-documento
      className="fixed inset-0 z-[95] bg-black animate-fade-in flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* barra: nome do arquivo + ações. Fica FORA do quadro do PDF, senão o
          leitor do navegador engolia o clique do X */}
      <div className="flex items-center gap-2 px-3 py-2 text-white shrink-0">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={nome}>
          {nome}
        </p>
        <a
          href={linkParaSalvar(src)}
          download={nome}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition"
          title="Salvar o arquivo no aparelho"
        >
          <Download className="size-5" />
        </a>
        <a
          href={src}
          target="_blank"
          rel="noopener"
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition hidden md:inline-flex"
          title="Abrir no leitor do navegador"
        >
          <ExternalLink className="size-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="p-2.5 rounded-full bg-white/15 hover:bg-white/30 transition"
        >
          <X className="size-5" />
        </button>
      </div>
      <div
        className="flex-1 min-h-0 overflow-auto bg-black"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <iframe
          src={src}
          title={nome}
          className="block w-full h-full min-h-full bg-white"
        />
      </div>
    </div>
  );
}
