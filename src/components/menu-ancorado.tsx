"use client";

/**
 * O MENU QUE SAI DE UM BOTÃO — sempre inteiro na tela.
 *
 * Relato do dono (15/09/2026): na lista de pedidos, tocar no selo de status
 * de um pedido do fim da lista abria o menu **cortado pela borda de baixo**
 * do celular; os últimos status ficavam inalcançáveis. A varredura que veio
 * junto mostrou que o mesmo defeito estava na cartela de cores e no balão "?"
 * dos números — cada um com a conta de posição escrita à mão, e cada cópia
 * errando de um jeito.
 *
 * Então a conta passou a viver num lugar só: `lib/menu-flutuante.ts` decide
 * (função pura, testada sem navegador) e este componente aplica.
 *
 * O que ele resolve, e que as versões à mão não resolviam:
 *  • **vira para cima** quando não cabe embaixo (nunca cobrindo o botão);
 *  • **para acima da barra de navegação** do celular, que é `fixed bottom-0`
 *    e come o pé da tela — caber "na janela" não bastava;
 *  • **rola por dentro** quando não cabe em lado nenhum (celular deitado),
 *    em vez de ficar com metade de fora;
 *  • **fecha ao rolar ou girar a tela**: as coordenadas são do instante da
 *    abertura, e sem isso o menu ficava boiando longe do botão.
 *
 * Mede antes de pintar (`useLayoutEffect` + `visibility: hidden`), senão o
 * menu aparece num canto e pula para o outro.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { Portal } from "@/components/portal";
import {
  alturaDaBarraInferior,
  alturaMaximaAncorada,
  posicaoAncorada,
} from "@/lib/menu-flutuante";

export function MenuAncorado({
  ancora,
  aberto,
  onFechar,
  largura,
  className = "",
  children,
}: {
  /** o botão que abriu o menu */
  ancora: React.RefObject<HTMLElement | null>;
  aberto: boolean;
  onFechar: () => void;
  /** largura em px (o menu é medido, mas a largura precisa ser fixa) */
  largura: number;
  className?: string;
  children: React.ReactNode;
}) {
  // ref de CALLBACK, não `useRef`: o `Portal` só põe os filhos no DOM depois
  // do próprio efeito de montagem, então no primeiro passo um `useRef` ainda
  // é `null` — o efeito saía sem medir e o menu ficava invisível para sempre,
  // porque nada nas dependências mudava para fazê-lo rodar de novo (achado da
  // revisão). Guardar o elemento em estado faz a medição acontecer no exato
  // momento em que ele existe.
  const [caixa, setCaixa] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [teto, setTeto] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!aberto) {
      setPos(null);
      // o teto TAMBÉM volta a zero: reaberto em outro lugar da tela, o menu
      // nasceria com o `maxHeight` da vez anterior e seria medido menor do que
      // é — aí "cabe embaixo" daria falso e ele estouraria a borda de novo
      setTeto(null);
      return;
    }
    const botao = ancora.current;
    const el = caixa;
    if (!botao || !el) return;
    const r = botao.getBoundingClientRect();
    const janela = { largura: window.innerWidth, altura: window.innerHeight };
    const reservaEmbaixo = alturaDaBarraInferior();
    const max = alturaMaximaAncorada(r, janela, { reservaEmbaixo });
    setTeto(max);
    setPos(
      posicaoAncorada(
        r,
        { largura, altura: Math.min(el.offsetHeight, max) },
        janela,
        { reservaEmbaixo }
      )
    );
  }, [aberto, ancora, largura, caixa]);

  // rolar ou girar move o botão e deixa o menu para trás: fecha, não persegue
  // (perseguir exigiria remedir a cada quadro, e o menu é para um toque só)
  useEffect(() => {
    if (!aberto) return;
    const fechar = () => onFechar();
    // o scroll é ouvido em CAPTURA (para pegar qualquer painel rolável da
    // página), e por isso chega também a rolagem de DENTRO do próprio menu —
    // que é justamente o recurso criado aqui. Rolar a cartela de cores, ou o
    // celular trazendo o campo do código para a vista, fechava o painel na
    // cara da pessoa (achado da revisão).
    const aoRolar = (e: Event) => {
      const alvo = e.target;
      if (alvo instanceof Node && caixa?.contains(alvo)) return;
      onFechar();
    };
    window.addEventListener("resize", fechar);
    window.addEventListener("orientationchange", fechar);
    window.addEventListener("scroll", aoRolar, true);
    return () => {
      window.removeEventListener("resize", fechar);
      window.removeEventListener("orientationchange", fechar);
      window.removeEventListener("scroll", aoRolar, true);
    };
  }, [aberto, onFechar, caixa]);

  if (!aberto) return null;

  return (
    <Portal>
      {/* clique fora fecha — e para a propagação, senão a linha inteira,
          que é um link, navegaria junto */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFechar();
        }}
      />
      <div
        ref={setCaixa}
        className={`fixed z-[61] overflow-y-auto overscroll-contain rounded-xl border border-gray-100 bg-white shadow-pop ${pos ? "animate-fade-in" : ""} ${className}`}
        style={{
          width: largura,
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          maxHeight: teto ?? undefined,
          // escondido até a medição: sem isso ele pisca de um canto ao outro
          visibility: pos ? "visible" : "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </Portal>
  );
}
