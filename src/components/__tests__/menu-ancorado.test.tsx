// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useRef, useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MenuAncorado } from "../menu-ancorado";

/**
 * O MENU ANCORADO, RENDERIZADO DE VERDADE.
 *
 * A conta de posição já é guardada por `menu-flutuante.test.ts` (função pura).
 * Estes testes guardam a APLICAÇÃO dela, que é onde a revisão achou o erro que
 * teria ido para produção: o `Portal` monta os filhos depois do próprio efeito,
 * então o `useRef` da caixa ainda era `null` na hora de medir — o menu nunca
 * ficava visível, e nada nas dependências mudava para tentar de novo.
 *
 * É o tipo de defeito que teste de função pura não alcança: a conta estava
 * certa, ninguém a chamava. Por isso estes testes olham o DOM.
 */

function janelaDeCelular(altura = 844, largura = 390) {
  Object.defineProperty(window, "innerWidth", { value: largura, writable: true });
  Object.defineProperty(window, "innerHeight", { value: altura, writable: true });
}

/** jsdom não faz layout: as medidas são ditadas aqui. */
function medir(el: HTMLElement, r: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}), ...r,
    }) as DOMRect;
}

function Exemplo({ topoDoBotao, alturaDoMenu }: { topoDoBotao: number; alturaDoMenu: number }) {
  const botao = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        ref={(el) => {
          botao.current = el;
          if (el) medir(el, { top: topoDoBotao, bottom: topoDoBotao + 20, left: 250, right: 330 });
        }}
        onClick={() => setAberto(true)}
      >
        abrir
      </button>
      <MenuAncorado ancora={botao} aberto={aberto} onFechar={() => setAberto(false)} largura={208}>
        <div
          data-testid="conteudo"
          ref={(el) => {
            const pai = el?.parentElement;
            if (!pai) return;
            Object.defineProperty(pai, "offsetHeight", {
              configurable: true,
              get() {
                // O NAVEGADOR CAPA A ALTURA PELO `maxHeight` APLICADO, e o
                // jsdom não faz layout — sem modelar isso aqui, o teto que
                // sobrasse de uma abertura anterior passaria despercebido,
                // que é justamente um dos achados da revisão.
                const teto = parseFloat(pai.style.maxHeight);
                return Number.isFinite(teto) ? Math.min(alturaDoMenu, teto) : alturaDoMenu;
              },
            });
          }}
        >
          oito status aqui
        </div>
      </MenuAncorado>
    </>
  );
}

const caixaDoMenu = () => screen.getByTestId("conteudo").parentElement!;

afterEach(cleanup);

describe("o menu aparece e fica dentro da tela", () => {
  it("FICA VISÍVEL ao abrir (o Portal monta depois — era aqui que ele sumia)", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={200} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    expect(caixaDoMenu().style.visibility).toBe("visible");
    expect(caixaDoMenu().style.top).not.toBe("");
  });

  it("botão no PÉ da tela: abre para cima, sem cobrir o botão nem sair da tela", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={760} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    const topo = parseFloat(caixaDoMenu().style.top);
    expect(topo).toBeGreaterThanOrEqual(0);
    expect(topo + 275).toBeLessThanOrEqual(760);
  });

  it("no lugar normal continua abrindo para baixo", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={100} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    expect(parseFloat(caixaDoMenu().style.top)).toBeGreaterThan(120);
  });

  it("ganha teto de altura e rola por dentro", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={200} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    expect(caixaDoMenu().style.maxHeight).not.toBe("");
    expect(caixaDoMenu().className).toContain("overflow-y-auto");
  });
});

describe("quando o menu fecha", () => {
  it("rolar a PÁGINA fecha", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={200} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    expect(screen.queryByTestId("conteudo")).not.toBeNull();
    fireEvent.scroll(window);
    expect(screen.queryByTestId("conteudo")).toBeNull();
  });

  it("mas rolar DENTRO do menu NÃO fecha — é o recurso que a rolagem criou", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={200} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    fireEvent.scroll(caixaDoMenu());
    expect(screen.queryByTestId("conteudo")).not.toBeNull();
  });

  it("girar a tela fecha (as coordenadas são do instante da abertura)", () => {
    janelaDeCelular();
    render(<Exemplo topoDoBotao={200} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    fireEvent(window, new Event("orientationchange"));
    expect(screen.queryByTestId("conteudo")).toBeNull();
  });
});

describe("reabrir em outro lugar da tela", () => {
  it("o teto é RECALCULADO, não herdado da vez anterior", () => {
    // herdando, o menu nasceria com o `maxHeight` antigo e seria medido menor
    // do que é — "cabe embaixo" daria falso e ele estouraria a borda de novo
    janelaDeCelular();
    const { rerender } = render(<Exemplo topoDoBotao={760} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    const noPe = parseFloat(caixaDoMenu().style.maxHeight);
    fireEvent.scroll(window); // fecha

    rerender(<Exemplo topoDoBotao={100} alturaDoMenu={275} />);
    fireEvent.click(screen.getByText("abrir"));
    const noTopo = parseFloat(caixaDoMenu().style.maxHeight);

    expect(noTopo).not.toBe(noPe);
    // no topo da tela o espaço que vale é o de BAIXO, e o menu abre para lá
    expect(parseFloat(caixaDoMenu().style.top)).toBeGreaterThan(120);
    expect(noTopo).toBeGreaterThan(275); // cabe inteiro, sem precisar rolar
  });
});

describe("a barra de navegação do celular é chão", () => {
  it("o menu para ACIMA dela", () => {
    janelaDeCelular();
    const barra = document.createElement("div");
    barra.className = "barra-inferior";
    medir(barra, { top: 772, bottom: 844, height: 72, left: 0, right: 390 });
    document.body.appendChild(barra);
    try {
      render(<Exemplo topoDoBotao={600} alturaDoMenu={200} />);
      fireEvent.click(screen.getByText("abrir"));
      expect(parseFloat(caixaDoMenu().style.top) + 200).toBeLessThanOrEqual(772);
    } finally {
      barra.remove();
    }
  });
});
