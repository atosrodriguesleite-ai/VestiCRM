import { describe, it, expect } from "vitest";
import { posicaoDoMenu, alturaMaxima, MARGEM } from "../menu-flutuante";

/**
 * "Conferir as extremidades, para que não corte as opções naquelas conversas
 * muito no canto superior ou inferior" (pedido do dono, 26/08/2026).
 */
const JANELA = { largura: 1280, altura: 800 };
const MENU = { largura: 240, altura: 220 };
const dentro = (p: { x: number; y: number }, menu = MENU, janela = JANELA) =>
  p.x >= MARGEM &&
  p.y >= MARGEM &&
  p.x + menu.largura + MARGEM <= janela.largura &&
  p.y + menu.altura + MARGEM <= janela.altura;

describe("o menu nunca fica com um pedaço fora da tela", () => {
  it("clique no meio: abre para baixo e para a direita, no ponto do clique", () => {
    const p = posicaoDoMenu({ x: 300, y: 300 }, MENU, JANELA);
    expect(p).toEqual({ x: 300, y: 300 });
    expect(dentro(p)).toBe(true);
  });

  it("conversa no PÉ da lista: o menu sobe em vez de cortar", () => {
    const p = posicaoDoMenu({ x: 300, y: 780 }, MENU, JANELA);
    expect(p.y).toBe(780 - MENU.altura); // a borda de baixo encosta no clique
    expect(dentro(p)).toBe(true);
  });

  it("conversa no TOPO da lista: continua abrindo para baixo", () => {
    const p = posicaoDoMenu({ x: 300, y: 12 }, MENU, JANELA);
    expect(p.y).toBe(12);
    expect(dentro(p)).toBe(true);
  });

  it("clique colado na borda direita: o menu abre para a esquerda", () => {
    const p = posicaoDoMenu({ x: 1270, y: 300 }, MENU, JANELA);
    expect(p.x).toBe(1270 - MENU.largura);
    expect(dentro(p)).toBe(true);
  });

  it("canto de baixo à direita (o pior caso): cabe inteiro", () => {
    const p = posicaoDoMenu({ x: 1279, y: 799 }, MENU, JANELA);
    expect(dentro(p)).toBe(true);
  });

  it("janela BAIXA demais para virar: encosta na margem, sem sair", () => {
    const baixa = { largura: 400, altura: 240 };
    const p = posicaoDoMenu({ x: 200, y: 200 }, MENU, baixa);
    expect(p.y).toBe(MARGEM); // empurrado para dentro
    expect(p.x).toBeGreaterThanOrEqual(MARGEM);
  });

  it("varredura: em QUALQUER ponto da janela o menu cabe", () => {
    for (let x = 0; x <= JANELA.largura; x += 37) {
      for (let y = 0; y <= JANELA.altura; y += 31) {
        const p = posicaoDoMenu({ x, y }, MENU, JANELA);
        expect(dentro(p), `clique em ${x},${y}`).toBe(true);
      }
    }
  });
});

describe("menu maior que a tela ganha rolagem, não sai da janela", () => {
  it("sobra mais espaço para cima quando o clique está no pé", () => {
    expect(alturaMaxima({ x: 0, y: 780 }, JANELA)).toBe(780 - MARGEM);
  });

  it("sobra mais espaço para baixo quando o clique está no topo", () => {
    expect(alturaMaxima({ x: 0, y: 20 }, JANELA)).toBe(800 - 20 - MARGEM);
  });

  it("nunca devolve altura negativa", () => {
    expect(alturaMaxima({ x: 0, y: 0 }, { largura: 100, altura: 4 })).toBe(0);
  });
});
