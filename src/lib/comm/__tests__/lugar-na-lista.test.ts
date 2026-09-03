import { describe, it, expect } from "vitest";
import {
  listaEstaEscondida,
  lugarParaVoltar,
  mostraAtalhoDaLista,
  sentidoDoAtalho,
  vaiDevolverOLugar,
  vaiGuardarOLugar,
} from "../../lugar-na-lista";

// Guarda RN-046 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * A LISTA DE CONVERSAS NÃO PERDE O LUGAR.
 *
 * Relato da loja (03/09/2026): a vendedora faz follow-up **de baixo para
 * cima** — desce até as conversas antigas, abre uma, encerra, e volta para o
 * TOPO da lista, tendo que rolar tudo de novo. O motivo é do navegador: no
 * celular a lista é escondida com `display:none` enquanto o chat está aberto,
 * e elemento escondido perde a rolagem.
 */

describe("guardar o lugar", () => {
  const VISIVEL = 620;

  it("guarda a posição onde ela estava", () => {
    expect(vaiGuardarOLugar(1840, VISIVEL)).toBe(true);
  });

  /**
   * O ZERO DA LISTA ESCONDIDA não é lugar nenhum — é o navegador jogando a
   * rolagem fora. Guardá-lo apagaria a posição boa que precisávamos manter.
   */
  it("NÃO guarda o zero que o navegador entrega ao esconder a lista", () => {
    expect(listaEstaEscondida(0)).toBe(true);
    expect(vaiGuardarOLugar(0, 0)).toBe(false);
  });

  /**
   * MAS O TOPO É UM LUGAR LEGÍTIMO: a vendedora que sobe de propósito tem que
   * continuar no topo ao voltar do chat. A primeira versão desta regra só
   * guardava posição maior que zero — e o topo ficava inalcançável, porque a
   * lista era puxada de volta ao lugar antigo toda vez (achado da revisão).
   */
  it("guarda o topo quando ela subiu de propósito (lista visível)", () => {
    expect(vaiGuardarOLugar(0, VISIVEL)).toBe(true);
    // e quem guardou o topo não é puxado para lugar nenhum
    expect(vaiDevolverOLugar(0, 0)).toBe(false);
  });

  it("número inválido não vira lugar", () => {
    expect(vaiGuardarOLugar(Number.NaN, VISIVEL)).toBe(false);
    expect(vaiGuardarOLugar(-50, VISIVEL)).toBe(false);
  });
});

describe("devolver o lugar", () => {
  it("volta ao lugar quando a lista reapareceu no topo", () => {
    expect(vaiDevolverOLugar(0, 1840)).toBe(true);
  });

  /**
   * No computador a lista nunca é escondida (fica ao lado do chat), então ela
   * já está no lugar certo: mexer no scroll ali seria um pulo do nada na
   * frente da vendedora.
   */
  it("não mexe na lista que já está no lugar (computador)", () => {
    expect(vaiDevolverOLugar(1840, 1840)).toBe(false);
  });

  it("sem lugar guardado, não faz nada", () => {
    expect(vaiDevolverOLugar(0, 0)).toBe(false);
  });
});

describe("para onde voltar", () => {
  it("volta exatamente para onde parou", () => {
    expect(lugarParaVoltar(1840, 4000)).toBe(1840);
  });

  /**
   * A lista ENCOLHE quando a conversa encerrada sai da aba. Pedir uma posição
   * que não existe mais faz o navegador ignorar o pedido — e ela volta ao
   * topo, que é exatamente o problema que a regra conserta.
   */
  it("lista que encolheu: encaixa no máximo possível", () => {
    expect(lugarParaVoltar(1840, 900)).toBe(900);
  });

  it("sem lugar guardado ou sem rolagem, é o topo", () => {
    expect(lugarParaVoltar(0, 4000)).toBe(0);
    expect(lugarParaVoltar(1840, 0)).toBe(0);
  });
});

describe("o atalho de descer/subir", () => {
  /** Em lista de meia tela o botão seria enfeite tampando conversa. */
  it("não aparece em lista que cabe na tela", () => {
    expect(mostraAtalhoDaLista(700, 800)).toBe(false);
    expect(mostraAtalhoDaLista(1400, 800)).toBe(false); // sobra menos de 1 tela
  });

  it("aparece quando sobra mais de uma tela para rolar", () => {
    expect(mostraAtalhoDaLista(4000, 800)).toBe(true);
  });

  it("altura inválida não desenha botão", () => {
    expect(mostraAtalhoDaLista(4000, 0)).toBe(false);
    expect(mostraAtalhoDaLista(Number.NaN, 800)).toBe(false);
  });

  /** Um botão só, sempre apontando para onde ainda falta ir. */
  it("aponta para o fim na metade de cima e para o topo na de baixo", () => {
    expect(sentidoDoAtalho(0, 3200)).toBe("fim");
    expect(sentidoDoAtalho(1500, 3200)).toBe("fim");
    expect(sentidoDoAtalho(2000, 3200)).toBe("topo");
    expect(sentidoDoAtalho(3200, 3200)).toBe("topo");
  });
});

/**
 * O CICLO INTEIRO foi reproduzido no NAVEGADOR DE VERDADE (Chromium, tela de
 * celular, 57 conversas), na entrega: rolar até o fim → abrir a última →
 * encerrar → voltar. Medido lá: a lista escondida devolve `clientHeight` e
 * `scrollHeight` ZERO (é daí que vem o problema), e com a lista zerada — o
 * que o Safari/iOS faz — o lugar guardado (4355) foi devolvido intacto.
 * Descrever aqui o texto do inbox.tsx (classe, nome de callback, trecho do
 * efeito) protegeria o erro em vez de impedi-lo, a lição de 28/08/2026: um
 * `scrollTop = 0` fixo — o próprio bug — passaria por qualquer busca de
 * substring.
 */
describe("o que a tela precisa da regra", () => {
  it("a lista escondida é reconhecida pelas medidas que o navegador dá", () => {
    // exatamente o que foi medido no Chromium com o chat aberto
    expect(listaEstaEscondida(0)).toBe(true);
    expect(mostraAtalhoDaLista(0, 0)).toBe(false);
    expect(vaiGuardarOLugar(0, 0)).toBe(false);
  });

  it("com a lista de volta e zerada, o lugar guardado é devolvido inteiro", () => {
    // números reais da medição: guardado 4355, conteúdo 4827, tela 472
    expect(vaiDevolverOLugar(0, 4355)).toBe(true);
    expect(lugarParaVoltar(4355, 4827 - 472)).toBe(4355);
  });
});
