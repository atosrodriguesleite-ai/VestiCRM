// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

/**
 * O ESQUELETO SÓ APARECE SE A TROCA DE TELA DEMORAR — o COMPORTAMENTO, não o
 * texto do código. O menu pede a tela inteira quando o dedo encosta; com rede
 * boa ela chega antes do tempo do esqueleto e nada pisca; com rede fraca o
 * esqueleto entra no lugar da tela velha, e sai no instante em que a troca
 * termina (ou é desfeita).
 */

let aCaminho = false;
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: aCaminho }) }));

import { MS_PARA_O_ESQUELETO, SinalDeNavegacao, useTrocaDemorada } from "@/components/sinal-de-navegacao";

function Tela() {
  const demorada = useTrocaDemorada();
  return (
    <>
      <SinalDeNavegacao />
      <p data-testid="estado">{demorada ? "esqueleto" : "tela"}</p>
    </>
  );
}
const estado = () => screen.getByTestId("estado").textContent;

beforeEach(() => {
  vi.useFakeTimers();
  aCaminho = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("troca de tela pelo menu", () => {
  it("parada: nem barra nem esqueleto", () => {
    const { container } = render(<Tela />);
    expect(container.querySelector(".barra-navegando")).toBeNull();
    expect(estado()).toBe("tela");
  });

  it("a barra aparece NA HORA; o esqueleto só depois do tempo", () => {
    aCaminho = true;
    const { container } = render(<Tela />);
    expect(container.querySelector(".barra-navegando")).not.toBeNull();
    expect(estado()).toBe("tela");
    act(() => void vi.advanceTimersByTime(MS_PARA_O_ESQUELETO - 1));
    expect(estado()).toBe("tela");
    act(() => void vi.advanceTimersByTime(1));
    expect(estado()).toBe("esqueleto");
  });

  it("a tela que chega ANTES do tempo nunca mostra o esqueleto", () => {
    aCaminho = true;
    const { rerender } = render(<Tela />);
    act(() => void vi.advanceTimersByTime(MS_PARA_O_ESQUELETO - 50));
    aCaminho = false;
    rerender(<Tela />);
    act(() => void vi.advanceTimersByTime(MS_PARA_O_ESQUELETO * 3));
    expect(estado()).toBe("tela");
  });

  it("a troca que termina (ou é desfeita) tira o esqueleto", () => {
    aCaminho = true;
    const { rerender } = render(<Tela />);
    act(() => void vi.advanceTimersByTime(MS_PARA_O_ESQUELETO));
    expect(estado()).toBe("esqueleto");
    aCaminho = false;
    rerender(<Tela />);
    expect(estado()).toBe("tela");
  });

  it("o link que some no meio da troca (a gaveta do menu fecha) não deixa o esqueleto preso", () => {
    aCaminho = true;
    function SoOEstado() {
      return <p data-testid="estado">{useTrocaDemorada() ? "esqueleto" : "tela"}</p>;
    }
    const { rerender } = render(<Tela />);
    act(() => void vi.advanceTimersByTime(MS_PARA_O_ESQUELETO));
    expect(estado()).toBe("esqueleto");
    rerender(<SoOEstado />);
    expect(estado()).toBe("tela");
  });
});
