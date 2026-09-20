import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alturaDoTeclado, areaVisivel, deslocamentoDaTela } from "../../components/keyboard-inset";

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

/**
 * A JANELA QUE SOBE COM O TECLADO (relato do dono, 21/09/2026, montando
 * pedido no celular): *"quando eu clico para colocar a quantidade, o teclado
 * aparece e joga o campo lá pra cima"*. O iOS empurra a TELA VISÍVEL para
 * baixo ao focar o campo; a janela é presa no topo da PÁGINA, então ela sai
 * por cima da borda. `--kbtop` é esse empurrão, para a janela descer junto.
 */
describe("o empurrão da tela (--kbtop) é medido à parte da altura do teclado", () => {
  /** celular com o teclado aberto: é o único estado em que a janela desce */
  const comTeclado = { innerHeight: 900, viewportHeight: 550, scale: 1, temCampoFocado: true };

  it("tela parada não desloca nada", () => {
    expect(deslocamentoDaTela({ ...comTeclado, offsetTop: 0 })).toBe(0);
  });

  it("iOS empurrando a tela ao abrir o teclado: a janela desce o mesmo tanto", () => {
    expect(deslocamentoDaTela({ ...comTeclado, offsetTop: 118 })).toBe(118);
    expect(deslocamentoDaTela({ ...comTeclado, offsetTop: 87.6 })).toBe(88);
  });

  it("zoom de pinça NÃO desloca: ali quem manda na posição é o dedo", () => {
    expect(deslocamentoDaTela({ ...comTeclado, scale: 1.5, offsetTop: 300 })).toBe(0);
  });

  it("valor negativo (rolagem elástica) não empurra a janela para cima", () => {
    expect(deslocamentoDaTela({ ...comTeclado, offsetTop: -40 })).toBe(0);
  });

  /**
   * As janelas de montar pedido não CALCULAM a área visível: elas usam a que
   * o navegador mede (`--vvh`/`--vvtop`) e travam a página de trás. Foi a
   * segunda tentativa, depois de o dono dizer que a janela continuava
   * subindo — a conta a partir do `innerHeight` não sobrevive ao iPhone.
   */
  it("as janelas de montar pedido se apoiam na área visível MEDIDA e travam a página", () => {
    for (const arquivo of ["src/app/(app)/pedidos/new-order.tsx", "src/components/order-composer.tsx"]) {
      const src = ler(arquivo);
      expect(src, arquivo).toContain("var(--vvh, 100dvh)");
      expect(src, arquivo).toContain("translateY(var(--vvtop, 0px))");
      expect(src, arquivo).toContain("useTravarFundo");
      // a conta antiga não pode voltar por engano
      expect(src, arquivo).not.toContain("100dvh_-_var(--kb");
    }
  });

  it("a área visível é o número cru do navegador, sem conta e sem sumir", () => {
    expect(areaVisivel({ height: 524.4, offsetTop: 0 })).toEqual({ altura: 524, topo: 0 });
    expect(areaVisivel({ height: 844, offsetTop: 118.6 })).toEqual({ altura: 844, topo: 119 });
    // rolagem elástica (valores negativos) não faz a janela desaparecer
    expect(areaVisivel({ height: 0, offsetTop: -30 })).toEqual({ altura: 1, topo: 0 });
  });

  it("a trava da página devolve o lugar em que a pessoa estava", () => {
    const src = ler("src/components/travar-fundo.ts");
    expect(src).toContain('body.style.position = "fixed"'); // overflow:hidden não trava o iOS
    expect(src).toContain("window.scrollTo(0, y)");
  });

  it("empurrão e teclado andam JUNTOS: sem teclado, nenhum dos dois desloca", () => {
    const semTeclado = { innerHeight: 900, viewportHeight: 900, scale: 1, temCampoFocado: false };
    // roletinha de escolha no iPhone: encolhe a tela sem ser teclado
    const roletinha = { innerHeight: 900, viewportHeight: 640, scale: 1, temCampoFocado: false };
    for (const m of [semTeclado, roletinha]) {
      expect(alturaDoTeclado(m)).toBe(0);
      expect(deslocamentoDaTela({ ...m, offsetTop: 120 })).toBe(0);
    }
    // com campo de digitação focado, os dois existem e se cancelam na conta
    const digitando = { innerHeight: 900, viewportHeight: 550, scale: 1, temCampoFocado: true };
    expect(alturaDoTeclado(digitando)).toBe(350);
    expect(deslocamentoDaTela({ ...digitando, offsetTop: 120 })).toBe(120);
    const fundoDaJanela = digitando.innerHeight - alturaDoTeclado(digitando) + 120;
    expect(fundoDaJanela).toBe(120 + digitando.viewportHeight); // exatamente o fim da área visível
  });

  /**
   * Varredura das JANELAS do app (as `fixed inset-0` que descontam o
   * teclado): quem desconta `--kb` tem que acompanhar `--kbtop` — são as
   * duas metades do mesmo problema, e a janela nova que esquecer a segunda
   * volta a sumir por cima da borda no iPhone.
   *
   * O que ela NÃO cobre, de propósito: as gavetas do catálogo público, que
   * são presas no rodapé (`bottom: var(--kb)`) em vez de ocuparem a tela
   * inteira — ali a compensação é outra conta e ainda não foi feita.
   */
  it("toda JANELA que desconta o teclado também acompanha o empurrão da tela", () => {
    const arquivos = execSync(
      'grep -rl "pb-\\[var(--kb,0px)\\]" src --include=*.tsx',
      { encoding: "utf8" }
    )
      .split("\n")
      .filter((f) => f && !f.endsWith("keyboard-inset.tsx"));
    expect(arquivos.length).toBeGreaterThan(20); // a varredura está achando as janelas
    const esquecidas: string[] = [];
    for (const arquivo of arquivos) {
      // o className pode estar quebrado em várias linhas: a varredura lê
      // cada um INTEIRO, senão bastava quebrar a linha para passar verde
      for (const [, classes] of ler(arquivo).matchAll(/className=\{?"([^"]*)"/g)) {
        const junto = classes.replace(/\s+/g, " ");
        if (junto.includes("fixed inset-0") && junto.includes("pb-[var(--kb,0px)]")) {
          if (!junto.includes("translate-y-[var(--kbtop,0px)]")) esquecidas.push(`${arquivo}: ${junto}`);
        }
      }
    }
    expect(esquecidas).toEqual([]);
  });
});
