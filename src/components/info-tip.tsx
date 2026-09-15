"use client";

/**
 * Dúvida sobre um número: ícone "?" que mostra a lógica do cálculo.
 * Desktop: aparece ao passar o mouse. Celular: aparece ao tocar.
 * O balão calcula a própria posição e NUNCA vaza pra fora da tela
 * (cards da coluna esquerda cortavam o texto no celular).
 */

import { useLayoutEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  alturaDaBarraInferior,
  alturaMaximaAncorada,
  posicaoAncorada,
} from "@/lib/menu-flutuante";

const LARGURA = 224; // w-56

export function InfoTip({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  const [balao, setBalao] = useState<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [teto, setTeto] = useState<number | null>(null);

  /**
   * A mesma conta do menu de status (15/09/2026): antes o balão só era preso
   * na horizontal e ia SEMPRE para baixo — num card do fim da página o texto
   * saía pela borda inferior, que é onde ele mais é lido no celular.
   *
   * A altura é MEDIDA, nunca estimada: chutar um número fazia o balão escolher
   * o lado errado e, no computador, abrir em cima do próprio "?" — o que
   * disparava `mouseleave`/`mouseenter` em sequência e virava pisca-pisca
   * (achado da revisão). Por isso ele nasce escondido e só aparece medido.
   */
  useLayoutEffect(() => {
    if (!aberto) {
      setPos(null);
      setTeto(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r || !balao) return;
    const janela = { largura: window.innerWidth, altura: window.innerHeight };
    const reservaEmbaixo = alturaDaBarraInferior();
    const max = alturaMaximaAncorada(r, janela, { reservaEmbaixo });
    setTeto(max);
    setPos(
      posicaoAncorada(
        r,
        { largura: LARGURA, altura: Math.min(balao.offsetHeight, max) },
        janela,
        { reservaEmbaixo }
      )
    );
  }, [aberto, balao]);

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        aria-label="Como é calculado"
        // toque SEMPRE abre (celulares disparam hover+clique juntos — alternar
        // fazia abrir e fechar no mesmo toque); fecha tocando fora da dica
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
        onMouseEnter={() => setAberto(true)}
        onMouseLeave={() => setAberto(false)}
        className="text-slate-300 hover:text-brand-500 transition"
      >
        <HelpCircle className="size-3.5" />
      </button>
      {aberto && (
        <>
          {/* fecha ao tocar fora (mobile) */}
          <span
            className="fixed inset-0 z-40 md:hidden"
            onClick={() => setAberto(false)}
          />
          <span
            ref={setBalao}
            role="tooltip"
            className="fixed z-50 w-56 overflow-y-auto rounded-xl bg-slate-900 text-white text-[11px] leading-relaxed font-normal normal-case tracking-normal px-3 py-2 shadow-pop"
            style={{
              top: pos?.y ?? 0,
              left: pos?.x ?? 0,
              maxHeight: teto ?? undefined,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
