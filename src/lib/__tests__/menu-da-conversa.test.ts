import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MENU DA CONVERSA (pedido do dono, 26/08/2026): clique direito no computador
 * e toque longo no celular abrem fixar/desfixar, marcar como não lida,
 * favoritar e bloquear — "igual ao aplicativo do WhatsApp".
 *
 * O que quebra em silêncio se alguém mexer:
 *  1. o menu voltar a nascer no ponto do clique SEM medir → conversa no pé da
 *     lista abre um menu com metade embaixo da borda;
 *  2. o toque longo não ser cancelado ao rolar → o menu abre no meio da
 *     rolagem, no celular, toda hora;
 *  3. bloquear virar coisa de qualquer um → fecha a porta de uma cliente para
 *     a loja inteira;
 *  4. marcar "bloqueada" sem o WhatsApp aceitar → a tela mente e as mensagens
 *     continuam chegando;
 *  5. a conversa fixada deixar de ir para o topo → fixar não serve para nada.
 */
const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const menu = ler("src/app/(app)/whatsapp/menu-da-conversa.tsx");
const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
const rota = ler("src/app/api/conversations/[id]/bloquear/route.ts");

describe("o menu abre inteiro, em qualquer canto", () => {
  it("mede o menu de verdade antes de posicionar", () => {
    // chutar a altura é o que faz o menu pular na tela ou continuar cortando
    expect(menu).toContain("useLayoutEffect");
    expect(menu).toContain("el.offsetHeight");
    expect(menu).toContain("posicaoDoMenu(em, menu, janela)");
  });

  it("menu maior que o espaço ganha rolagem em vez de sair da tela", () => {
    expect(menu).toContain("alturaMaxima(em, janela)");
    expect(menu).toContain("overflow-y-auto");
  });

  it("não pisca no lugar errado enquanto não mediu", () => {
    expect(menu).toContain('visibility: posicao ? "visible" : "hidden"');
  });
});

describe("os dois gestos", () => {
  it("clique direito no computador", () => {
    expect(inbox).toContain("onContextMenu={(e) => {");
    expect(inbox).toContain("setMenuConv({ conv: c, em: { x: e.clientX, y: e.clientY } });");
  });

  it("toque longo no celular, cancelado ao ROLAR a lista", () => {
    // rolar não pode abrir menu; o cancelamento tem tolerância para o tremor
    expect(inbox).toContain("cancelarToqueLongo();");
    expect(inbox).toContain("onTouchEnd={cancelarToqueLongo}");
    expect(inbox).toContain("onTouchCancel={cancelarToqueLongo}");
  });

  it("no celular o menu sobe de baixo (flutuante some debaixo do dedo)", () => {
    expect(menu).toContain("if (!noComputador) {");
    expect(menu).toContain("items-end");
  });
});

describe("as quatro opções pedidas", () => {
  it("fixar/desafixar, não lida, favoritos e bloquear", () => {
    expect(menu).toContain("Desafixar conversa");
    expect(menu).toContain("Fixar conversa");
    expect(menu).toContain("Marcar como não lida");
    expect(menu).toContain("Adicionar aos favoritos");
    expect(menu).toContain("Bloquear");
  });

  it("conversa fixada vai para o topo, em qualquer aba", () => {
    expect(inbox).toContain("if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;");
  });
});

describe("bloquear é sério", () => {
  it("só gerência", () => {
    expect(rota).toContain("if (!isManagerUp(user))");
  });

  it("só marca DEPOIS que o WhatsApp aceita", () => {
    // marcar antes deixaria a tela dizendo "bloqueada" com mensagem chegando
    expect(rota.indexOf("evoBlockContact")).toBeLessThan(rota.indexOf("db.customer.update"));
    expect(rota).toContain("A cliente NÃO foi bloqueada.");
  });

  it("fica registrado na linha do tempo (quem e quando)", () => {
    expect(rota).toContain("db.customerEvent.create");
  });

  it("a conversa de destino passa pelo escopo (RN-013)", () => {
    expect(rota).toContain("...conversationScope(user)");
  });

  it("sem WhatsApp conectado, RECUSA — não marca só aqui", () => {
    // achado da revisão: o padrão do CommSettings é MOCK, então toda loja
    // recém-criada gravaria "bloqueada" com as mensagens continuando a chegar
    expect(rota).toContain('s?.activeProvider !== "EVOLUTION" || !s.evolutionInstance');
    expect(rota).toContain("o bloqueio precisa acontecer lá, não só aqui");
  });

  it("tempo esgotado é 'não sei', não 'não foi'", () => {
    // o pedido pode ter chegado; dizer que não foi faria tentar de novo
    expect(rota).toContain("r.incerto");
    expect(rota).toContain("não deu para confirmar");
  });
});

describe("achados da revisão na tela", () => {
  it("o filtro de favoritas some só quando está desligado", () => {
    expect(inbox).toContain("(favoritasNaLista > 0 || soFavoritas)");
  });

  it("o clique que vem depois do toque longo é descartado", () => {
    // no iPhone ele vem, e abrir a conversa zerava o contador de não lidas
    expect(inbox).toContain("if (menuAbriuNoToque.current) {");
  });

  it("tremor do dedo não cancela o toque longo", () => {
    expect(inbox).toContain("Math.abs(t.clientX - i.x) > 10");
  });

  it("desfazer mexe só no que foi alterado", () => {
    // devolver o objeto inteiro apagaria a mensagem que o sync trouxe
    expect(inbox).toContain("const desfazer =");
    expect(inbox).toContain("{ ...c, ...desfazer }");
  });
});
