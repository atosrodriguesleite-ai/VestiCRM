"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { useLinkStatus } from "next/link";

/**
 * RESPOSTA NA HORA AO TOQUE NO MENU (22/10/2026, relato do dono: "clico numa
 * tela pelo celular e demora uns 3 segundos para mudar; fica como se tivesse
 * travado, aí às vezes clico mais de uma vez").
 *
 * Mora DENTRO do <Link> (é lá que o `useLinkStatus` sabe se aquele link está
 * a caminho) e, enquanto a próxima tela não chega, mostra a barrinha cobre
 * correndo no topo da tela — o "recebi seu toque, estou indo". Esta barra
 * não depende de nada, aparece no mesmo instante do toque.
 *
 * `marca`: a classe do traço que o item ganha quando é a tela aberta — o item
 * tocado passa a parecer escolhido na hora, sem esperar a tela nova.
 *
 * O ESQUELETO SÓ APARECE SE A TROCA DEMORAR (15/11/2026). O menu passou a
 * pedir a tela INTEIRA quando o dedo encosta (`adiantar`, no app-shell), e
 * aí o Next não tem mais o esqueleto guardado para mostrar na hora: ele
 * espera a tela chegar. Medido no navegador: com rede boa a tela nova chega
 * ~50 ms depois do clique e o esqueleto só piscaria; com rede fraca (400 ms)
 * a tela ficava meio segundo só com a barrinha. Então quem mostra o
 * esqueleto somos nós: passados `MS_PARA_O_ESQUELETO` com a troca ainda a
 * caminho, o app-shell troca a tela velha pelo esqueleto (`useTrocaDemorada`).
 */
export const MS_PARA_O_ESQUELETO = 200;

// loja minúscula, fora do React: quantas trocas de tela estão demorando
let demorando = 0;
const ouvintes = new Set<() => void>();
function contar(d: 1 | -1) {
  demorando += d;
  ouvintes.forEach((avisar) => avisar());
}
function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

/** `true` enquanto uma troca de tela pelo menu passou do tempo do esqueleto. */
export function useTrocaDemorada(): boolean {
  return useSyncExternalStore(
    assinar,
    () => demorando > 0,
    () => false
  );
}

export function SinalDeNavegacao({ marca }: { marca?: string }) {
  const { pending } = useLinkStatus();
  // layout effect: a troca que TERMINA tira o esqueleto no mesmo quadro em
  // que a tela nova aparece (com effect comum sobrava um quadro de esqueleto
  // por cima da tela pronta)
  useLayoutEffect(() => {
    if (!pending) return;
    let contou = false;
    const relogio = setTimeout(() => {
      contou = true;
      contar(1);
    }, MS_PARA_O_ESQUELETO);
    return () => {
      clearTimeout(relogio);
      if (contou) contar(-1);
    };
  }, [pending]);
  if (!pending) return null;
  return (
    <>
      <span aria-hidden className="barra-navegando" />
      {marca && <span aria-hidden className={marca} />}
      <span className="sr-only">Abrindo…</span>
    </>
  );
}
