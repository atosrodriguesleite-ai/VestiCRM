import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * TOCAR NA BARRA TEM QUE LEVAR AO LUGAR CERTO.
 *
 * Relato da Toque Leve (07/08/2026): "clico em Conjuntos de calça e está
 * bugando, não vai para o local selecionado". Na tela aparecia a seção de
 * Legging com o chip "Conjuntos de short" aceso.
 *
 * Eram DOIS problemas, e os dois nasceram de número de pixel cravado no
 * código (140, 140, 74):
 *
 *  1. a rolagem parava a 140px do topo — mas a barra grudada tinha crescido
 *     (a lupa nova), então a seção parava ATRÁS dela;
 *  2. o vigia de rolagem usava a mesma margem de 140px, então acendia o chip
 *     de uma seção que ainda estava escondida atrás da barra.
 *
 * E havia um terceiro, mais antigo: durante a rolagem suave, as seções que
 * passam voando acendiam o chip errado no caminho.
 *
 * Altura agora é MEDIDA. Este teste impede o pixel cravado de voltar.
 */

const fonte = readFileSync(
  join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
  "utf8"
);

describe("a barra do catálogo não usa altura cravada", () => {
  it("a seção para abaixo da barra usando a altura medida", () => {
    expect(fonte).toContain('scrollMarginTop: "var(--cat-sticky, 150px)"');
    // o 140 cravado é exatamente o que quebrou quando a barra cresceu
    expect(/scrollMarginTop:\s*\n?\s*[^"'\n]*\b140\b/.test(fonte)).toBe(false);
  });

  it("a barra gruda usando a altura medida do cabeçalho", () => {
    expect(fonte).toContain('top: "var(--cat-hdr, 74px)"');
  });

  it("o vigia de rolagem usa a MESMA altura medida", () => {
    expect(fonte).toContain("rootMargin: `-${alturaFixa}px 0px -55% 0px`");
    expect(/rootMargin:\s*"-140px/.test(fonte)).toBe(false);
  });

  it("a altura é remedida quando a barra muda de tamanho", () => {
    expect(/setAlturaFixa\(/.test(fonte)).toBe(true);
    expect(/ResizeObserver/.test(fonte)).toBe(true);
    // e o vigia é refeito com a nova altura (rootMargin só vale na criação)
    expect(/\}, \[categories, alturaFixa\]\)/.test(fonte)).toBe(true);
  });
});

describe("tocar no tipo/categoria acende o chip certo", () => {
  it("tipo e categoria passam pelo MESMO caminho", () => {
    expect(/onClick=\{\(\) => irParaSecao\(g\.categorias\[0\]\)\}/.test(fonte)).toBe(true);
    expect(/onClick=\{\(\) => irParaSecao\(cat\)\}/.test(fonte)).toBe(true);
  });

  it("a barra responde na hora, sem esperar a rolagem terminar", () => {
    expect(/setActiveCat\(alvo\)/.test(fonte)).toBe(true);
  });

  it("o vigia fica quieto durante a rolagem suave", () => {
    // sem a trava, as seções do caminho acendem o chip errado e a barra
    // termina acesa em outro tipo — exatamente o print da loja
    expect(/spyTravadoAte/.test(fonte)).toBe(true);
    expect(/Date\.now\(\) < spyTravadoAte\.current/.test(fonte)).toBe(true);
  });
});
