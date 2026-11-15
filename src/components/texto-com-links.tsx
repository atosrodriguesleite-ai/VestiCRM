"use client";

import { Fragment, useMemo } from "react";
import { ondeAbrir, partesDoTexto } from "@/lib/links-do-texto";

/**
 * O TEXTO DA BOLHA, COM OS LINKS CLICÁVEIS (`lib/links-do-texto.ts`).
 *
 * - O link abre FORA (aba nova; no aplicativo instalado, o navegador do
 *   aparelho por cima). `noopener noreferrer`: a página aberta não alcança a
 *   janela do sistema nem fica sabendo de qual conversa veio.
 * - Endereço do próprio sistema dentro do aplicativo instalado abre na
 *   janela que quem chama fornecer (`aoAbrirDentro`) — abrir "fora" ali
 *   prenderia a pessoa na página, sem botão de voltar.
 * - `ativo={false}` desenha o texto cru: é o modo de MARCAR TEXTO do
 *   celular, em que o toque serve para arrastar as alças, não para navegar.
 * - `engolirClique`: quem chama diz se ESTE clique deve ser ignorado — o
 *   toque longo que acabou de abrir o menu da mensagem solta um clique ao
 *   levantar o dedo em alguns aparelhos, e o link abriria por cima do menu.
 */
export function TextoComLinks({
  texto,
  ativo = true,
  className,
  aoAbrirDentro,
  engolirClique,
}: {
  texto: string;
  ativo?: boolean;
  /** classes do link (a cor depende da bolha) */
  className?: string;
  aoAbrirDentro?: (href: string) => void;
  engolirClique?: () => boolean;
}) {
  const partes = useMemo(() => partesDoTexto(texto), [texto]);
  if (!ativo || !partes.some((p) => p.tipo === "link")) return <>{texto}</>;
  return (
    <>
      {partes.map((p, i) =>
        p.tipo === "texto" ? (
          <Fragment key={i}>{p.texto}</Fragment>
        ) : (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            // marca dos links do TEXTO (a tela os separa do link de salvar
            // arquivo, que também é um <a>)
            data-link-do-texto
            // o toque longo é do menu da MENSAGEM: sem isto o iPhone abre por
            // cima a prévia do link dele
            style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
            className={`underline underline-offset-2 break-all ${className ?? ""}`}
            onClick={(e) => {
              if (engolirClique?.()) {
                e.preventDefault();
                return;
              }
              if (!aoAbrirDentro) return;
              const instalado =
                window.matchMedia("(display-mode: standalone)").matches ||
                // iOS antigo expõe só a flag própria do Safari
                Boolean((navigator as { standalone?: boolean }).standalone);
              if (ondeAbrir(p.href, window.location.origin, instalado) === "janela") {
                e.preventDefault();
                aoAbrirDentro(p.href);
              }
            }}
          >
            {p.texto}
          </a>
        )
      )}
    </>
  );
}
