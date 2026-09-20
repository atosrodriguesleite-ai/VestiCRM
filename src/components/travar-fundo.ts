"use client";

import { useEffect } from "react";

/**
 * TRAVA A PÁGINA DE TRÁS enquanto a janela está aberta.
 *
 * Por que `position: fixed` e não `overflow: hidden`: no iPhone o Safari
 * ROLA A PÁGINA sozinho para "acomodar" o campo quando o teclado sobe, e
 * `overflow: hidden` não o impede — a janela ia junto e sumia por cima da
 * borda (relato do dono, 21/09/2026, digitando quantidade na grade). Com o
 * corpo da página fixo não há o que rolar, e a janela fica onde está.
 *
 * O lugar em que a pessoa estava é guardado (`top: -y`) e devolvido no fim:
 * sem isso, fechar a janela jogaria a lista de pedidos de volta para o topo
 * e ela perderia o lugar — o mesmo cuidado da RN-046.
 */
export function useTravarFundo(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    const y = window.scrollY;
    const body = document.body;
    const antes = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };
    // NO COMPUTADOR, tirar a página do fluxo some com a barra de rolagem e o
    // conteúdo de trás pula ~15px para o lado ao abrir e ao fechar. A folga
    // entra como espaço à direita, do tamanho exato da barra que sumiu
    // (no celular a barra não ocupa lugar e a conta dá zero).
    const barra = window.innerWidth - document.documentElement.clientWidth;
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    if (barra > 0) body.style.paddingRight = `${barra}px`;
    return () => {
      Object.assign(body.style, antes);
      /**
       * Força o navegador a refazer a conta da altura ANTES de devolver o
       * lugar. Com o corpo fixo a página não tem onde rolar, e o pedido de
       * rolagem feito no mesmo instante é IGNORADO — a lista voltava para o
       * topo ao fechar a janela (medido no navegador). É a mesma lição do
       * `requestAnimationFrame` da RN-046: posição que ainda não existe o
       * navegador descarta.
       */
      void body.offsetHeight;
      window.scrollTo(0, y);
    };
  }, [ativo]);
}
