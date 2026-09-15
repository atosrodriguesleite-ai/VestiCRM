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

// ---------------------------------------------------------------------------
// MENU ANCORADO A UM BOTÃO (relato do dono, 15/09/2026): na lista de pedidos,
// o selo de status do ÚLTIMO pedido abria o menu cortado pela borda de baixo.
// ---------------------------------------------------------------------------

import { posicaoAncorada, alturaMaximaAncorada, FOLGA_DA_ANCORA } from "../menu-flutuante";

/** Celular em pé, com a barra de navegação ocupando o pé da tela. */
const CELULAR = { largura: 390, altura: 844 };
const BARRA = 72;
/** o selo de status tem ~20px de altura e fica na ponta direita da linha */
const selo = (topo: number) => ({ top: topo, bottom: topo + 20, left: 250, right: 330 });
const MENU_STATUS = { largura: 208, altura: 300 };

describe("menu ancorado: o caso que o dono relatou", () => {
  it("selo no PÉ da lista abre para CIMA, inteiro dentro da tela", () => {
    // o pedido está quase encostado na barra de navegação
    const ancora = selo(700);
    const p = posicaoAncorada(ancora, MENU_STATUS, CELULAR, { reservaEmbaixo: BARRA });
    // abriu acima do botão, sem cobri-lo
    expect(p.y + MENU_STATUS.altura).toBeLessThanOrEqual(ancora.top - FOLGA_DA_ANCORA);
    expect(p.y).toBeGreaterThanOrEqual(MARGEM);
  });

  it("e o menu NUNCA invade a barra de navegação", () => {
    const chao = CELULAR.altura - BARRA;
    for (let topo = 0; topo <= CELULAR.altura; topo += 7) {
      const ancora = selo(topo);
      const janelaUtil = { ...CELULAR };
      const max = alturaMaximaAncorada(ancora, janelaUtil, { reservaEmbaixo: BARRA });
      const menu = { largura: 208, altura: Math.min(MENU_STATUS.altura, max) };
      const p = posicaoAncorada(ancora, menu, janelaUtil, { reservaEmbaixo: BARRA });
      expect(p.y).toBeGreaterThanOrEqual(MARGEM - 0.01);
      expect(p.y + menu.altura).toBeLessThanOrEqual(chao - MARGEM + 0.01);
    }
  });

  it("no lugar normal (meio da tela) continua abrindo para BAIXO", () => {
    const ancora = selo(200);
    const p = posicaoAncorada(ancora, MENU_STATUS, CELULAR, { reservaEmbaixo: BARRA });
    expect(p.y).toBe(ancora.bottom + FOLGA_DA_ANCORA);
  });

  it("virar é abrir ACIMA do botão — nunca subir até cobri-lo", () => {
    // é o que separa esta conta da do menu de contexto: se ele subisse até o
    // ponto do clique, taparia o próprio selo que a pessoa tocou
    const ancora = selo(700);
    const p = posicaoAncorada(ancora, MENU_STATUS, CELULAR, { reservaEmbaixo: BARRA });
    expect(p.y + MENU_STATUS.altura).toBeLessThan(ancora.top);
  });
});

describe("menu ancorado: alinhamento e telas apertadas", () => {
  it("a direita do menu acompanha a direita do botão", () => {
    const ancora = selo(200);
    const p = posicaoAncorada(ancora, MENU_STATUS, CELULAR, { reservaEmbaixo: BARRA });
    expect(p.x + MENU_STATUS.largura).toBe(ancora.right);
  });

  it("botão colado na esquerda não empurra o menu para fora", () => {
    const ancora = { top: 200, bottom: 220, left: 4, right: 40 };
    const p = posicaoAncorada(ancora, MENU_STATUS, CELULAR, { reservaEmbaixo: BARRA });
    expect(p.x).toBeGreaterThanOrEqual(MARGEM);
    expect(p.x + MENU_STATUS.largura).toBeLessThanOrEqual(CELULAR.largura - MARGEM);
  });

  it("celular DEITADO: não cabendo em lado nenhum, vai para o mais folgado com teto", () => {
    const deitado = { largura: 844, altura: 390 };
    const ancora = { top: 180, bottom: 200, left: 700, right: 780 };
    const max = alturaMaximaAncorada(ancora, deitado, { reservaEmbaixo: BARRA });
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(MENU_STATUS.altura); // não cabe inteiro em lugar nenhum
    const menu = { largura: 208, altura: max };
    const p = posicaoAncorada(ancora, menu, deitado, { reservaEmbaixo: BARRA });
    expect(p.y).toBeGreaterThanOrEqual(MARGEM);
    expect(p.y + menu.altura).toBeLessThanOrEqual(deitado.altura - BARRA - MARGEM + 0.01);
  });

  it("no computador não há barra: o espaço ABAIXO é a tela inteira", () => {
    // a barra só come espaço para baixo — acima do botão ela não muda nada,
    // então a comparação tem que ser feita num selo do TOPO da tela
    const pc = { largura: 1280, altura: 800 };
    const ancora = selo(40);
    const semBarra = alturaMaximaAncorada(ancora, pc);
    const comBarra = alturaMaximaAncorada(ancora, pc, { reservaEmbaixo: BARRA });
    expect(semBarra).toBe(comBarra + BARRA);
  });
});
