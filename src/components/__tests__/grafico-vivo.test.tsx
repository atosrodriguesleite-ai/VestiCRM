// @vitest-environment jsdom
// Guarda RN-089
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { SerieViva, FunilVivo } from "../grafico-vivo";

/**
 * RN-089 — os gráficos vivos do BI: a mira acha o ponto pela POSIÇÃO (o
 * dedo não precisa acertar a linha), o balão mostra o valor, o teclado anda
 * pelos pontos, e o funil diz a conversão de cada etapa.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a série viva", () => {
  const pontos = [1, 5, 2, 8];
  const rotulos = ["01/10", "02/10", "03/10", "04/10"];
  function montar() {
    const r = render(<SerieViva titulo="Teste" points={pontos} labels={rotulos} />);
    const caixa = screen.getByTestId("serie-viva");
    // o jsdom não mede: a caixa tem 600px de largura começando em 0
    vi.spyOn(caixa, "getBoundingClientRect").mockReturnValue({ left: 0, width: 600, top: 0, height: 180, right: 600, bottom: 180, x: 0, y: 0, toJSON: () => ({}) });
    return { ...r, caixa };
  }
  it("o estado final vem do servidor: a linha e a área já estão visíveis sem JavaScript (a entrada é CSS)", () => {
    const { container } = montar();
    const linha = container.querySelector("path.gv-linha") as SVGPathElement;
    expect(linha.getAttribute("stroke-dashoffset")).toBe("0");
    expect(linha.getAttribute("d")).toMatch(/^M/);
  });
  it("sem toque, só o pico tem rótulo aqui (o último colide com o pico e sai) — nunca número em todo ponto", () => {
    montar();
    // o pico é o último ponto (8): um rótulo só
    expect(screen.getAllByText("8")).toHaveLength(1);
    expect(screen.queryByText("5")).toBeNull();
  });
  it("a mira acha o ponto pela posição e o balão mostra o valor; sair com o mouse apaga", () => {
    const { caixa } = montar();
    fireEvent.pointerMove(caixa, { clientX: 200 });
    expect(screen.getByRole("status").textContent).toContain("5");
    expect(screen.getByRole("status").textContent).toContain("02/10");
    fireEvent.pointerLeave(caixa);
    expect(screen.getByRole("status").textContent).toBe("");
  });
  it("no TOQUE a seleção fica depois de o dedo sair, e só some tocando fora", () => {
    const { caixa } = montar();
    fireEvent.pointerDown(caixa, { clientX: 200, pointerType: "touch" });
    fireEvent.pointerLeave(caixa);
    expect(screen.getByRole("status").textContent).toContain("5");
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(screen.getByRole("status").textContent).toBe("");
  });
  it("o teclado anda pelos pontos: foco abre no último, seta esquerda volta", () => {
    const { caixa } = montar();
    fireEvent.focus(caixa);
    expect(screen.getByRole("status").textContent).toContain("8");
    fireEvent.keyDown(caixa, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toContain("2");
    fireEvent.keyDown(caixa, { key: "Escape" });
    expect(screen.getByRole("status").textContent).toBe("");
  });
  it("a seleção que sobrevive a uma série MAIS CURTA (voltou do 30 dias para o 7) não quebra a tela", () => {
    const r = render(<SerieViva titulo="Teste" points={[1, 2, 3, 4, 5, 6, 7, 8]} labels={["a", "b", "c", "d", "e", "f", "g", "h"]} />);
    const caixa = screen.getByTestId("serie-viva");
    fireEvent.focus(caixa); // abre no último (índice 7)
    expect(screen.getByRole("status").textContent).toContain("8");
    r.rerender(<SerieViva titulo="Teste" points={[1, 2]} labels={["a", "b"]} />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.getByTestId("serie-viva").className).toContain("touch-pan-y");
  });
  it("sem pontos não quebra: diz que não há dados", () => {
    render(<SerieViva titulo="Vazio" points={[]} labels={[]} />);
    expect(screen.getByText(/Sem dados/)).toBeTruthy();
  });
});

describe("o funil vivo", () => {
  it("UM foco por gráfico: Tab entra na lista, as setas andam pelas etapas, Esc solta (uma parada por barra afastava o teclado)", () => {
    render(<FunilVivo data={[{ label: "Contatos", value: 40 }, { label: "Respondidos", value: 20 }, { label: "Pagaram", value: 5 }]} />);
    expect(screen.getAllByRole("listitem").every((li) => !li.hasAttribute("tabindex"))).toBe(true);
    const lista = screen.getByRole("list");
    expect(lista.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(lista);
    expect(screen.getByRole("status").textContent).toContain("40 · Contatos");
    fireEvent.keyDown(lista, { key: "ArrowDown" });
    expect(screen.getByRole("status").textContent).toContain("50% do começo");
    fireEvent.keyDown(lista, { key: "Escape" });
    expect(screen.getByRole("status").textContent).toBe("");
  });
  it("o balão do funil fica preso ao cartão (quebra linha em vez de sair da tela) e é legível nos dois temas (classe própria)", () => {
    const { container } = render(<FunilVivo data={[{ label: "Respondidos por uma pessoa da equipe", value: 40 }, { label: "Pagaram", value: 5 }]} />);
    fireEvent.pointerEnter(screen.getAllByRole("listitem")[0]);
    const balao = container.querySelector(".gv-balao") as HTMLElement;
    expect(balao.className).toContain("max-w-full");
    expect(balao.className).toContain("whitespace-normal");
    expect(balao.className).not.toContain("bg-slate-900");
  });
  it("a barra cresce por variável CSS (--gv-w) e pinta pelo token do tema — um width inline venceria o @starting-style", () => {
    const { container } = render(<FunilVivo data={[{ label: "Contatos", value: 40 }, { label: "Pagaram", value: 10 }]} />);
    const barras = container.querySelectorAll<HTMLElement>(".gv-barra");
    expect(barras[0].style.getPropertyValue("--gv-w")).toBe("100%");
    expect(barras[1].style.getPropertyValue("--gv-w")).toBe("25%");
    expect(barras[0].style.width).toBe("");
    expect(barras[0].style.backgroundColor).toBe("var(--gv-funil-1)");
    expect(barras[1].style.backgroundColor).toBe("var(--gv-funil-2)");
  });
  it("diz a conversão de cada etapa e, ao passar, a % do começo", () => {
    render(<FunilVivo data={[{ label: "Contatos", value: 40 }, { label: "Respondidos", value: 20 }, { label: "Pagaram", value: 5 }]} />);
    expect(screen.getByText(/50% da anterior/)).toBeTruthy();
    expect(screen.getByText(/25% da anterior/)).toBeTruthy();
    const itens = screen.getAllByRole("listitem");
    fireEvent.pointerEnter(itens[2]);
    expect(screen.getByRole("status").textContent).toContain("13% do começo");
  });
});
