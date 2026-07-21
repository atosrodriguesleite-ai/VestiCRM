"use client";

import { useEffect } from "react";

/**
 * Mede a altura do teclado do celular (uma vez, no app inteiro) e expõe em
 * `--kb` na raiz da página. O iOS/Safari não encolhe a página quando o
 * teclado abre, então usamos a Visual Viewport para descobrir quanto o
 * teclado ocupa. As janelas (modais/bottom-sheets) usam esse valor via CSS
 * (`pb-[var(--kb,0px)]` no container e uma altura máxima que desconta `--kb`)
 * para nunca esconderem o botão atrás do teclado. Sem teclado, `--kb` = 0px
 * e nada muda. Renderiza nada.
 */
export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", `${kb}px`);
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
