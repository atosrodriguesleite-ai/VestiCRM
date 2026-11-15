// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.atacadopro.com/whatsapp" }
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TextoComLinks } from "@/components/texto-com-links";

/**
 * O TEXTO DA BOLHA COM OS LINKS CLICÁVEIS — o COMPORTAMENTO na tela: o link
 * abre fora sem entregar a janela do sistema, o modo de marcar texto desenha
 * o texto cru, e o endereço do próprio sistema no aplicativo instalado vai
 * para a janela com X em vez de prender a tela.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const instalado = (sim: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: sim && q.includes("standalone") }));

describe("links na bolha", () => {
  it("o link abre em aba nova, sem entregar a janela nem a origem", () => {
    const { container } = render(<TextoComLinks texto="veja https://catalago.net/loja agora" />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://catalago.net/loja");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(container.textContent).toBe("veja https://catalago.net/loja agora");
  });

  it("texto sem link sai como veio, sem nenhum <a>", () => {
    const { container } = render(<TextoComLinks texto={"oi, tudo bem?\nquero 3 no P"} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("oi, tudo bem?\nquero 3 no P");
  });

  it("no modo de marcar texto o link vira texto cru", () => {
    const { container } = render(<TextoComLinks texto="https://catalago.net/loja" ativo={false} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("https://catalago.net/loja");
  });

  it("o que a cliente escreve nunca vira marcação da página", () => {
    const { container } = render(
      <TextoComLinks texto={'<img src=x onerror=alert(1)> https://a.com/"><script>x</script>'} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("aplicativo instalado + endereço do PRÓPRIO sistema: abre na janela, não navega", () => {
    instalado(true);
    const dentro = vi.fn();
    const proprio = `${window.location.origin}/rastreio/abc`;
    const { container } = render(<TextoComLinks texto={`rastreio: ${proprio}`} aoAbrirDentro={dentro} />);
    const seguiu = fireEvent.click(container.querySelector("a")!);
    expect(dentro).toHaveBeenCalledWith(proprio);
    expect(seguiu).toBe(false); // a navegação foi impedida
  });

  it("aplicativo instalado + endereço de FORA: segue o link normal", () => {
    instalado(true);
    const dentro = vi.fn();
    const { container } = render(<TextoComLinks texto="https://catalago.net/loja" aoAbrirDentro={dentro} />);
    const seguiu = fireEvent.click(container.querySelector("a")!);
    expect(dentro).not.toHaveBeenCalled();
    expect(seguiu).toBe(true);
  });

  it("o clique que vem logo depois do toque longo é ignorado (o menu da mensagem abriu)", () => {
    const { container } = render(
      <TextoComLinks texto="https://catalago.net/loja" engolirClique={() => true} />
    );
    expect(fireEvent.click(container.querySelector("a")!)).toBe(false);
  });

  it("o link do texto leva a marca que o separa do link de salvar arquivo", () => {
    const { container } = render(<TextoComLinks texto="https://catalago.net/loja" />);
    expect(container.querySelector("a[data-link-do-texto]")).not.toBeNull();
  });

  it("no navegador comum o endereço do próprio sistema também segue o link normal", () => {
    instalado(false);
    const dentro = vi.fn();
    const proprio = `${window.location.origin}/rastreio/abc`;
    const { container } = render(<TextoComLinks texto={proprio} aoAbrirDentro={dentro} />);
    fireEvent.click(container.querySelector("a")!);
    expect(dentro).not.toHaveBeenCalled();
  });
});
