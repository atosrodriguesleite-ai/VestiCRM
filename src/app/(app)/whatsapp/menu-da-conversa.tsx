"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Pin, PinOff, MailOpen, Star, StarOff, Ban, ShieldCheck } from "lucide-react";
import { posicaoDoMenu, alturaMaxima, MARGEM } from "@/lib/menu-flutuante";

/**
 * MENU DA CONVERSA — clique direito no computador, toque longo no celular
 * (pedido do dono, 26/08/2026, "igual ao aplicativo do WhatsApp").
 *
 * No COMPUTADOR ele nasce no ponto do clique e vira para o lado que tem
 * espaço, encostando na margem quando não cabe: conversa no pé da lista abria
 * um menu com metade embaixo da borda, sem jeito de alcançar. A regra é pura
 * e testada (`lib/menu-flutuante.ts`); aqui ela só é aplicada, depois de
 * MEDIR o menu de verdade — chutar a altura é o que faz o menu "pular" na
 * tela ou continuar cortando.
 *
 * No CELULAR ele sobe de baixo, como todas as outras folhas de ação da
 * Central. Menu flutuante no dedo não funciona: some debaixo da mão.
 */

export type AcoesDaConversa = {
  fixada: boolean;
  favorita: boolean;
  bloqueada: boolean;
  /** só gerência bloqueia — para o resto o item aparece explicando por quê */
  podeBloquear: boolean;
  onFixar: () => void;
  onFavoritar: () => void;
  onNaoLida: () => void;
  onBloquear: () => void;
};

export function MenuDaConversa({
  em,
  noComputador,
  acoes,
  onFechar,
}: {
  /** ponto do clique (computador) — no celular vira folha de baixo */
  em: { x: number; y: number };
  noComputador: boolean;
  acoes: AcoesDaConversa;
  onFechar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState<{ x: number; y: number } | null>(null);
  const [teto, setTeto] = useState<number | null>(null);

  // MEDE E ENCAIXA antes de pintar: `useLayoutEffect` roda depois do DOM
  // existir e ANTES de a tela desenhar, então o menu já aparece no lugar
  // certo — sem piscar de um canto para o outro.
  useLayoutEffect(() => {
    if (!noComputador) return;
    const el = caixa.current;
    if (!el) return;
    const janela = { largura: window.innerWidth, altura: window.innerHeight };
    const max = alturaMaxima(em, janela);
    const menu = {
      largura: el.offsetWidth,
      altura: Math.min(el.offsetHeight, max),
    };
    setTeto(max);
    setPosicao(posicaoDoMenu(em, menu, janela));
  }, [em, noComputador]);

  const itens = [
    {
      chave: "fixar",
      rotulo: acoes.fixada ? "Desafixar conversa" : "Fixar conversa",
      Icone: acoes.fixada ? PinOff : Pin,
      acao: acoes.onFixar,
      tom: "text-gray-700",
    },
    {
      chave: "nao-lida",
      rotulo: "Marcar como não lida",
      Icone: MailOpen,
      acao: acoes.onNaoLida,
      tom: "text-gray-700",
    },
    {
      chave: "favorita",
      rotulo: acoes.favorita ? "Tirar dos favoritos" : "Adicionar aos favoritos",
      Icone: acoes.favorita ? StarOff : Star,
      acao: acoes.onFavoritar,
      tom: "text-gray-700",
    },
    {
      chave: "bloquear",
      rotulo: acoes.bloqueada ? "Desbloquear" : "Bloquear",
      Icone: acoes.bloqueada ? ShieldCheck : Ban,
      acao: acoes.onBloquear,
      tom: acoes.bloqueada ? "text-emerald-700" : "text-rose-600",
    },
  ];

  const lista = (
    <>
      {itens.map(({ chave, rotulo, Icone, acao, tom }) => {
        const travado = chave === "bloquear" && !acoes.podeBloquear;
        return (
          <button
            key={chave}
            type="button"
            disabled={travado}
            title={travado ? "Bloquear uma cliente é decisão da gerência." : undefined}
            onClick={() => {
              acao();
              onFechar();
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 ${tom}`}
          >
            <Icone className="size-4 shrink-0 opacity-70" />
            {rotulo}
          </button>
        );
      })}
    </>
  );

  // ---- CELULAR: folha que sobe de baixo ----
  if (!noComputador) {
    return (
      <div
        className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 animate-fade-in"
        onClick={onFechar}
      >
        <div
          className="w-full rounded-t-2xl bg-white p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          {lista}
          <button
            onClick={onFechar}
            className="mt-1 w-full rounded-xl border-t border-gray-100 px-3 py-3 text-center text-sm font-semibold text-gray-500 hover:bg-gray-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ---- COMPUTADOR: no ponto do clique, sempre inteiro na tela ----
  return (
    <div className="fixed inset-0 z-[90]" onClick={onFechar} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={caixa}
        onClick={(e) => e.stopPropagation()}
        style={{
          left: posicao?.x ?? em.x,
          top: posicao?.y ?? em.y,
          maxHeight: teto ?? undefined,
          // enquanto não mediu, fica invisível: senão aparece por um quadro
          // no lugar errado (o "pulo" que o WhatsApp não tem)
          visibility: posicao ? "visible" : "hidden",
        }}
        className="fixed w-60 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-pop"
      >
        {lista}
      </div>
    </div>
  );
}

export { MARGEM };
