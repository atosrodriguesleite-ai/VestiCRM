import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alturaDoTeclado } from "../../components/keyboard-inset";

/**
 * A GAVETA PRESA NO MEIO DA TELA (incidente da loja Entre Linhas, 17/08/2026).
 *
 * No NOTEBOOK, a janela "SEU PEDIDO" do catálogo ficou pendurada no meio da
 * tela e o ✕ não fechava. Causa: a medição do teclado do celular
 * (`innerHeight - visualViewport.height`) também dispara no computador quando
 * a pessoa dá zoom de pinça — o sistema "via" 300px de teclado onde não há
 * teclado nenhum. Como a gaveta fechada se apoia em `--kb` para subir, ela
 * descia só a própria altura e sobrava na tela. E clicar no ✕ não fazia nada:
 * para o sistema ela JÁ estava fechada.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("medir o teclado: só quando existe teclado", () => {
  const celularDigitando = {
    innerHeight: 800,
    viewportHeight: 450,
    scale: 1,
    temCampoFocado: true,
  };

  it("celular com o teclado aberto mede a altura certa", () => {
    expect(alturaDoTeclado(celularDigitando)).toBe(350);
  });

  // O CASO DO INCIDENTE
  it("notebook com zoom de pinça NÃO vira teclado", () => {
    expect(
      alturaDoTeclado({ innerHeight: 900, viewportHeight: 600, scale: 1.5, temCampoFocado: true })
    ).toBe(0);
  });
  it("sem campo de digitação focado NÃO existe teclado (o caso do catálogo)", () => {
    // a cliente só navega e clica em peças — nenhum campo em foco
    expect(
      alturaDoTeclado({ innerHeight: 900, viewportHeight: 600, scale: 1, temCampoFocado: false })
    ).toBe(0);
  });
  it("oscilação pequena (barra de endereço) não conta", () => {
    expect(
      alturaDoTeclado({ innerHeight: 800, viewportHeight: 740, scale: 1, temCampoFocado: true })
    ).toBe(0);
  });
  it("tela maior que o viewport nunca dá número negativo", () => {
    expect(
      alturaDoTeclado({ innerHeight: 600, viewportHeight: 800, scale: 1, temCampoFocado: true })
    ).toBe(0);
  });

  it("o medidor escuta o foco (senão o valor fica preso depois de fechar o teclado)", () => {
    const c = ler("src/components/keyboard-inset.tsx");
    expect(c).toContain('window.addEventListener("focusin", update)');
    expect(c).toContain('window.addEventListener("focusout", update)');
    expect(c).toContain("campoDeDigitacaoFocado");
  });
  it("botão/caixa de marcar em foco não sobe nada (não abre teclado)", () => {
    const c = ler("src/components/keyboard-inset.tsx");
    expect(c).toContain('"checkbox"');
    expect(c).toContain('"button"');
  });
  // O `focusout` dispara no APERTAR do dedo: baixar na hora tirava o botão
  // debaixo do toque e a cliente clicava em "Enviar pedido" sem efeito
  it("SUBIR é imediato, BAIXAR espera (o toque não cai no vazio)", () => {
    const c = ler("src/components/keyboard-inset.tsx");
    expect(c).toContain("if (kb > 0) return aplicar(kb)");
    expect(c).toContain("baixarDepois = setTimeout(");
    expect(c).toContain("clearTimeout(baixarDepois)");
  });
  it("aparelho de toque não dá zoom automático no campo (senão o teclado some da conta)", () => {
    expect(ler("src/app/globals.css")).toContain("(max-width: 767px), (pointer: coarse)");
  });
});

describe("gaveta fechada é gaveta INVISÍVEL (catálogo público)", () => {
  const cat = ler("src/app/catalogo/[slug]/public-catalog.tsx");

  it("ao fechar, o deslocamento do teclado desce junto (não sobra na tela)", () => {
    const n = cat.split('translateY(calc(100% + var(--kb, 0px)))').length - 1;
    expect(n).toBe(2); // a gaveta do produto E a da sacola
    expect(cat).not.toContain('"translateY(100%)"'); // o jeito antigo, que sobrava
  });
  it("fechada não fica visível nem rouba clique", () => {
    expect(cat).toContain('visibility: sheet ? "visible" : "hidden"');
    expect(cat).toContain('visibility: bagOpen ? "visible" : "hidden"');
    expect(cat).toContain('pointerEvents: bagOpen ? "auto" : "none"');
  });
  it("a descida continua animada (visibility acompanha a transição)", () => {
    expect(cat).toContain('transition: "transform .3s, visibility .3s"');
  });
});
