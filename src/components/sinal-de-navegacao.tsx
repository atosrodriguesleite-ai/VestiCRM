"use client";

import { useLinkStatus } from "next/link";

/**
 * RESPOSTA NA HORA AO TOQUE NO MENU (22/10/2026, relato do dono: "clico numa
 * tela pelo celular e demora uns 3 segundos para mudar; fica como se tivesse
 * travado, aí às vezes clico mais de uma vez").
 *
 * Mora DENTRO do <Link> (é lá que o `useLinkStatus` sabe se aquele link está
 * a caminho) e, enquanto a próxima tela não chega, mostra a barrinha cobre
 * correndo no topo da tela — o "recebi seu toque, estou indo". O esqueleto
 * de carregamento (`loading.tsx`) depende de uma resposta do servidor; esta
 * barra não depende de nada, aparece no mesmo instante do toque.
 *
 * `marca`: a classe do traço que o item ganha quando é a tela aberta — o item
 * tocado passa a parecer escolhido na hora, sem esperar a tela nova.
 */
export function SinalDeNavegacao({ marca }: { marca?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span aria-hidden className="barra-navegando" />
      {marca && <span aria-hidden className={marca} />}
      <span className="sr-only">Abrindo…</span>
    </>
  );
}
