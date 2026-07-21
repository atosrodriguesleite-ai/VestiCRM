"use client";

import { useEffect } from "react";

/**
 * Mede a altura do teclado do celular (uma vez, no app inteiro) e expõe em
 * `--kb` na raiz da página. As janelas (modais/bottom-sheets) usam esse valor
 * via CSS (`pb-[var(--kb,0px)]` no container e uma altura máxima que desconta
 * `--kb`) para nunca esconderem o botão atrás do teclado.
 *
 * Detalhe importante do iOS: ao focar um campo, o Safari ROLA a página para
 * mostrar o campo, e o `visualViewport.offsetTop` fica positivo. Se usássemos
 * o offset na conta, a altura do teclado "encolheria" durante a rolagem e a
 * janela voltaria para baixo. Por isso medimos a altura do teclado de forma
 * ESTÁVEL (`innerHeight - visualViewport.height`), independente da rolagem.
 *
 * Sem teclado, `--kb` = 0px e nada muda. Renderiza nada.
 */
export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      // altura estável do teclado: NÃO desconta o offset da rolagem do iOS
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
      // ignora oscilações mínimas (barra de url, etc.) para não piscar
      root.style.setProperty("--kb", kb > 80 ? `${kb}px` : "0px");
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--kb");
    };
  }, []);
  return null;
}
