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
 *
 * E expõe TAMBÉM `--kbtop` (21/09/2026, relato do dono montando pedido no
 * celular: *"quando eu clico para colocar a quantidade, o teclado aparece e
 * joga o campo lá pra cima"*). São duas coisas diferentes: `--kb` é o quanto
 * o teclado OCUPA, e `--kbtop` é o quanto o iOS EMPURROU a tela visível para
 * baixo ao focar o campo. A janela é `position: fixed`, presa no topo da
 * página — quando o Safari desliza a tela visível, ela sai por cima da
 * borda, que é o que o print mostrava. Quem usa `--kbtop` desce a janela
 * pelo mesmo tanto e ela fica colada na área que a pessoa está vendo.
 * O valor mora à PARTE de propósito: entrar na conta do `--kb` faria a
 * altura do teclado encolher durante a rolagem, que é o bug descrito acima.
 */

type MedidaDaTela = {
  innerHeight: number;
  /** altura visível (visualViewport.height) */
  viewportHeight: number;
  /** zoom do visual viewport (1 = sem zoom) */
  scale: number;
  /** existe um campo de digitação com o foco? */
  temCampoFocado: boolean;
};

/**
 * Altura do teclado em pixels — ou 0 quando não há teclado nenhum.
 *
 * BUG REAL (17/08/2026, loja Entre Linhas): no NOTEBOOK, dar zoom de pinça
 * encolhe o `visualViewport` sem encolher a janela, e a conta antiga
 * (`innerHeight - viewportHeight`) media "300px de teclado" num computador
 * que não tem teclado na tela. Como as gavetas do catálogo se apoiam em
 * `--kb` para subir, a sacola fechada ficava PENDURADA no meio da tela — e
 * clicar no ✕ não fazia nada, porque para o sistema ela já estava fechada.
 *
 * Duas condições agora: só conta como teclado se houver um CAMPO DE
 * DIGITAÇÃO com o foco, e se a tela não estiver com zoom de pinça.
 */
export function alturaDoTeclado(m: MedidaDaTela): number {
  if (!m.temCampoFocado) return 0;
  // zoom de pinça encolhe o visualViewport: a diferença não é teclado
  if (m.scale > 1.01) return 0;
  const kb = Math.max(0, Math.round(m.innerHeight - m.viewportHeight));
  // ignora oscilações mínimas (barra de url, etc.) para não piscar
  return kb > 80 ? kb : 0;
}

/**
 * Quanto a tela visível foi empurrada para baixo (o `offsetTop` do visual
 * viewport) — o tanto que a janela precisa descer para continuar colada no
 * que a pessoa vê.
 *
 * **Só vale quando há teclado** (a MESMA conta do `--kb`), e isso não é
 * detalhe: as duas medidas se cancelam na conta da janela
 * (`fundo = innerHeight − kb + kbtop`). Se uma existisse sem a outra, o
 * rodapé sairia da tela — é o que aconteceria ao tocar num campo de
 * ESCOLHA no iPhone, onde a roletinha encolhe a tela sem ser teclado:
 * `--kb` daria 0 (não é campo de digitação) e o empurrão sozinho jogaria o
 * botão de salvar para baixo da borda (achado da revisão).
 */
export function deslocamentoDaTela(m: MedidaDaTela & { offsetTop: number }): number {
  if (alturaDoTeclado(m) <= 0) return 0;
  return Math.max(0, Math.round(m.offsetTop));
}

/** O elemento com o foco aceita digitação (é o que faz o teclado subir)? */
function campoDeDigitacaoFocado(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const tipo = (el as HTMLInputElement).type;
    // campos sem teclado (botão, caixa de marcar, cor...) não sobem nada
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(tipo);
  }
  return el.isContentEditable;
}

export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let baixarDepois: ReturnType<typeof setTimeout> | null = null;
    const medir = () =>
      alturaDoTeclado({
        innerHeight: window.innerHeight,
        viewportHeight: vv.height,
        scale: vv.scale ?? 1,
        temCampoFocado: campoDeDigitacaoFocado(),
      });
    const aplicar = (kb: number) => root.style.setProperty("--kb", `${kb}px`);
    /**
     * O deslocamento é pura geometria da tela: vale na hora, subindo E
     * descendo. Não entra no atraso de 150ms do `--kb` (que existe para a
     * gaveta não fugir do dedo entre o apertar e o soltar) — atrasar aqui
     * deixaria a janela fora do lugar justamente durante a rolagem.
     */
    const aplicarTopo = () =>
      root.style.setProperty(
        "--kbtop",
        `${deslocamentoDaTela({
          innerHeight: window.innerHeight,
          viewportHeight: vv.height,
          scale: vv.scale ?? 1,
          temCampoFocado: campoDeDigitacaoFocado(),
          offsetTop: vv.offsetTop,
        })}px`
      );

    /**
     * SUBIR é imediato; BAIXAR espera um instante.
     *
     * O `focusout` dispara no APERTAR do dedo (mousedown), antes do soltar.
     * Baixando na hora, a gaveta apoiada em `--kb` descia ~350px ENTRE o
     * apertar e o soltar — e o toque em "Enviar pedido no WhatsApp" caía no
     * vazio: a cliente clicava e não acontecia nada (revisão 17/08/2026, o
     * mesmo cuidado que o app-shell já tomava). Trocar de campo também não
     * pode fazer a janela pular.
     */
    const update = () => {
      aplicarTopo();
      const kb = medir();
      if (baixarDepois) {
        clearTimeout(baixarDepois);
        baixarDepois = null;
      }
      if (kb > 0) return aplicar(kb);
      baixarDepois = setTimeout(() => {
        baixarDepois = null;
        aplicar(medir());
      }, 150);
    };

    aplicar(medir());
    aplicarTopo();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    // o teclado nasce e morre com o foco do campo: sem ouvir isso, `--kb`
    // ficava preso no último valor medido depois de fechar o teclado
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      if (baixarDepois) clearTimeout(baixarDepois);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      root.style.removeProperty("--kb");
      root.style.removeProperty("--kbtop");
    };
  }, []);
  return null;
}
