import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import sharp from "sharp";
import {
  comZoom,
  encaixar,
  enquadramentoInicial,
  enquadramentoSchema,
  estiloDaJanela,
  janelaEmPixels,
  lerEnquadramento,
  limitesDaLargura,
  mesmoEnquadramento,
  mover,
  JANELA_MINIMA,
} from "../enquadramento";
import { imagemDaCor } from "../capa-por-cor";
import { prepararFotoDoPdf } from "../catalogo/foto-do-pdf";
import { ImagemEnquadrada } from "@/components/imagem-enquadrada";

// Guarda RN-107 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * ENQUADRAMENTO DA FOTO: a loja escolhe a janela 3:4 que o card do catálogo
 * e o PDF mostram; a foto fica inteira. A régua é pura e UMA para a tela
 * (CSS), a porta (validação) e o PDF (sharp).
 */

describe("ler o enquadramento gravado", () => {
  it("aceita a janela dentro da foto", () => {
    expect(lerEnquadramento({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
  });
  it("valor torto vira null — o card cai no corte de sempre, nunca quebra", () => {
    expect(lerEnquadramento(null)).toBeNull();
    expect(lerEnquadramento("x")).toBeNull();
    expect(lerEnquadramento({ x: -0.1, y: 0, w: 0.5, h: 0.5 })).toBeNull();
    expect(lerEnquadramento({ x: 0.6, y: 0, w: 0.5, h: 0.5 })).toBeNull(); // sai pela direita
    expect(lerEnquadramento({ x: 0, y: 0.7, w: 0.5, h: 0.5 })).toBeNull(); // sai por baixo
    expect(lerEnquadramento({ x: 0, y: 0, w: 0, h: 0.5 })).toBeNull(); // sem tamanho
    expect(lerEnquadramento({ x: 0, y: 0, w: "0.5", h: 0.5 })).toBeNull();
    expect(lerEnquadramento({ x: NaN, y: 0, w: 0.5, h: 0.5 })).toBeNull();
  });
  it("a porta recusa a janela torta pela MESMA régua (400, nunca gravado)", () => {
    expect(enquadramentoSchema.safeParse({ x: 0.6, y: 0, w: 0.5, h: 0.5 }).success).toBe(false);
    expect(enquadramentoSchema.safeParse({ x: 0, y: 0, w: 0.5, h: 0.6 }).success).toBe(true);
    expect(enquadramentoSchema.safeParse(null).success).toBe(true); // tirar
    expect(enquadramentoSchema.safeParse(undefined).success).toBe(true); // preservar
  });
});

describe("a janela de partida é o que o card mostra hoje (topo, centrada)", () => {
  it("foto em pé 3:4 exata: a foto inteira", () => {
    expect(enquadramentoInicial(300, 400)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
  it("foto deitada: altura inteira, largura centrada", () => {
    const e = enquadramentoInicial(1600, 1200);
    expect(e.h).toBe(1);
    expect(e.w).toBeCloseTo(0.5625, 3); // 1200·3/4 = 900 de 1600
    expect(e.x).toBeCloseTo((1 - 0.5625) / 2, 3);
    expect(e.y).toBe(0);
  });
  it("foto 9:16 do celular: largura inteira, ancorada no TOPO (a cabeça fica)", () => {
    const e = enquadramentoInicial(1080, 1920);
    expect(e.w).toBe(1);
    expect(e.x).toBe(0);
    expect(e.y).toBe(0);
    expect(e.h).toBeCloseTo(0.75, 3); // 1080·4/3 = 1440 de 1920
  });
});

describe("mover e dar zoom nunca saem da foto nem perdem a proporção", () => {
  const W = 1600;
  const H = 1200;
  const proporcaoEmPixels = (e: { w: number; h: number }) => (e.w * W) / (e.h * H);

  it("mover além da borda para na borda", () => {
    const e = enquadramentoInicial(W, H);
    const m = mover(e, 5, 5, W, H);
    expect(m.x + m.w).toBeCloseTo(1, 4);
    expect(m.y + m.h).toBeCloseTo(1, 4);
    const n = mover(e, -5, -5, W, H);
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
  });
  it("zoom aproxima mantendo o centro e a proporção 3:4 em pixels", () => {
    const e = enquadramentoInicial(W, H);
    const z = comZoom(e, 0.5, W, H);
    expect(proporcaoEmPixels(z)).toBeCloseTo(3 / 4, 2);
    expect(z.x + z.w / 2).toBeCloseTo(e.x + e.w / 2, 3);
    expect(z.y + z.h / 2).toBeCloseTo(e.y + e.h / 2, 3);
  });
  it("tem teto de zoom (a janela nunca fica menor que o mínimo) e de afastamento (nunca maior que a foto)", () => {
    const e = enquadramentoInicial(W, H);
    expect(comZoom(e, 0.0001, W, H).w).toBeCloseTo(JANELA_MINIMA, 4);
    expect(comZoom(e, 100, W, H).w).toBeCloseTo(e.w, 4);
  });
  it("janela gravada numa foto que mudou de tamanho é re-encaixada", () => {
    const e = encaixar({ x: 0.9, y: 0.9, w: 0.5 }, 1000, 1000);
    expect(e.x + e.w).toBeLessThanOrEqual(1);
    expect(e.y + e.h).toBeLessThanOrEqual(1);
    // foto quadrada: a janela 3:4 em pixels tem w/h = 0,75
    expect(e.w / e.h).toBeCloseTo(0.75, 2);
  });
  it("os limites da largura são UMA conta (o editor e o encaixe leem a mesma)", () => {
    expect(limitesDaLargura(1600, 1200)).toEqual({ minW: JANELA_MINIMA, maxW: 0.5625 });
    expect(limitesDaLargura(1080, 1920)).toEqual({ minW: JANELA_MINIMA, maxW: 1 });
    // foto minúscula na altura: o mínimo nunca passa do máximo
    const { minW, maxW } = limitesDaLargura(1000, 100);
    expect(minW).toBeLessThanOrEqual(maxW);
    expect(limitesDaLargura(0, 0)).toEqual({ minW: 1, maxW: 1 });
  });
  it("foto sem medida não quebra", () => {
    expect(encaixar({ x: 0, y: 0, w: 1 }, 0, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("a mesma janela nos dois desenhos", () => {
  it("em pixels (sharp): inteira e dentro da foto", () => {
    expect(janelaEmPixels({ x: 0.25, y: 0, w: 0.5, h: 1 }, 1600, 1200)).toEqual({ left: 400, top: 0, width: 800, height: 1200 });
    // arredondamento nunca estoura a borda
    const j = janelaEmPixels({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 333, 777);
    expect(j.left + j.width).toBeLessThanOrEqual(333);
    expect(j.top + j.height).toBeLessThanOrEqual(777);
  });
  it("em CSS: a imagem esticada e deslocada para a janela ocupar o quadro", () => {
    // a altura é `auto` de propósito: a foto segue a proporção dela e uma
    // janela torta nunca a deforma (achado da revisão)
    expect(estiloDaJanela({ x: 0.25, y: 0, w: 0.5, h: 1 })).toMatchObject({
      left: "-50%",
      top: "0%",
      width: "200%",
      height: "auto",
    });
  });
  it("o componente do card aplica o estilo com janela e o corte de sempre sem ela", () => {
    const com = renderToStaticMarkup(
      createElement(ImagemEnquadrada, { src: "a.jpg", enquadramento: { x: 0.25, y: 0, w: 0.5, h: 1 } })
    );
    expect(com).toContain("left:-50%");
    expect(com).toContain("width:200%");
    expect(com).not.toContain("object-cover");
    // o componente é dono do quadro: moldura 3:4 que esconde o que vaza
    expect(com).toContain("overflow-hidden");
    expect(com).toContain("aspect-ratio:3/4");
    const sem = renderToStaticMarkup(createElement(ImagemEnquadrada, { src: "a.jpg", enquadramento: null }));
    expect(sem).toContain("object-cover object-top");
  });
  it("mesmoEnquadramento ignora diferença abaixo da precisão gravada", () => {
    expect(mesmoEnquadramento({ x: 0.12345, y: 0, w: 0.5, h: 0.5 }, { x: 0.12346, y: 0, w: 0.5, h: 0.5 })).toBe(true);
    expect(mesmoEnquadramento({ x: 0.1, y: 0, w: 0.5, h: 0.5 }, { x: 0.2, y: 0, w: 0.5, h: 0.5 })).toBe(false);
    expect(mesmoEnquadramento(null, undefined)).toBe(true);
    expect(mesmoEnquadramento(null, { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });
});

describe("a foto do card por cor leva a janela DELA", () => {
  const fotos = [
    { url: "capa.jpg", color: null, enquadramento: { x: 0, y: 0, w: 1, h: 1 } },
    { url: "azul.jpg", color: "Azul", enquadramento: { x: 0.2, y: 0, w: 0.5, h: 1 } },
  ];
  it("etiquetada: a dela; sem etiqueta: a capa", () => {
    expect(imagemDaCor(fotos, "Azul")?.enquadramento.x).toBe(0.2);
    expect(imagemDaCor(fotos, "Preto")?.url).toBe("capa.jpg");
  });
});

/**
 * O PDF recorta a MESMA janela, medida no pixel: uma foto deitada com a
 * metade esquerda VERMELHA e a direita AZUL. Sem janela, o corte de sempre
 * (centrado) mistura as duas; com a janela na metade direita, o resultado é
 * azul de ponta a ponta.
 */
describe("o PDF obedece à janela (medido no pixel)", () => {
  async function fotoDeDuasCores(): Promise<Buffer> {
    const esquerda = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ff0000" } }).png().toBuffer();
    return sharp({ create: { width: 800, height: 300, channels: 3, background: "#0000ff" } })
      .composite([{ input: esquerda, left: 0, top: 0 }])
      .png()
      .toBuffer();
  }
  const corNoPonto = async (jpeg: Buffer, x: number, y: number) => {
    const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const { width } = await sharp(jpeg).metadata();
    const i = (y * (width ?? 0) + x) * 3;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };

  it("sem janela: centrado — vermelho à esquerda e azul à direita", async () => {
    const jpeg = await prepararFotoDoPdf(await fotoDeDuasCores(), 4 / 3, null);
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(420);
    expect(meta.height).toBe(560);
    const esq = await corNoPonto(jpeg, 10, 100);
    const dir = await corNoPonto(jpeg, 410, 100);
    expect(esq.r).toBeGreaterThan(200);
    expect(dir.b).toBeGreaterThan(200);
  });

  it("a foto de celular DEITADA (orientação EXIF) é virada antes de medir a janela", async () => {
    // a foto larga (vermelho | azul) gravada com orientação 6 (90° horário):
    // virada, o vermelho fica EM CIMA e o azul EMBAIXO, numa foto 300 × 800.
    // A janela no terço de baixo (frações da foto JÁ virada) tem que sair azul
    const deitada = await sharp(await fotoDeDuasCores()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const janela = { x: 0, y: 0.6, w: 1, h: 0.375 }; // 300 × 300 de 300 × 800 → cobre 3:4 pelo topo
    const jpeg = await prepararFotoDoPdf(deitada, 4 / 3, janela);
    for (const x of [5, 210, 415]) {
      const c = await corNoPonto(jpeg, x, 100);
      expect(c.b).toBeGreaterThan(200);
      expect(c.r).toBeLessThan(60);
    }
  });

  it("com a janela na metade azul: azul de ponta a ponta, no mesmo tamanho", async () => {
    // a janela 3:4 em pixels dentro da metade direita (800 × 300): 225 × 300
    const janela = { x: 0.6, y: 0, w: 0.28125, h: 1 };
    const jpeg = await prepararFotoDoPdf(await fotoDeDuasCores(), 4 / 3, janela);
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(420);
    expect(meta.height).toBe(560);
    for (const x of [5, 210, 415]) {
      const c = await corNoPonto(jpeg, x, 280);
      expect(c.b).toBeGreaterThan(200);
      expect(c.r).toBeLessThan(60);
    }
  });
});
