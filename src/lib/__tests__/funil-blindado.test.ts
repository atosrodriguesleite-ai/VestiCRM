import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Blindagens da aba FUNIL (revisão especialista de 18/08/2026) + a saída do
 * romaneio no celular. Guardas de arquivo: cada regra abaixo já esteve
 * quebrada — o teste impede a volta.
 *
 * (Os guardiões oficiais de RN-003/RN-007/RN-013/RN-014 são outros testes,
 * citados em docs/regras.md; aqui se tranca a APLICAÇÃO delas nas portas do
 * funil, que a revisão achou abertas.)
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("excluir oportunidade tem as MESMAS travas do excluir pedido", () => {
  const rota = ler("src/app/api/opportunities/[id]/route.ts");
  const acoes = ler("src/lib/order-actions.ts");
  it("pagamento de gateway confirmado recusa a exclusão (rastro do dinheiro)", () => {
    expect(rota).toContain("temPagamentoConfirmadoDeGateway");
    expect(rota).toContain("status: 409");
    // a trava compartilhada cobre os dois gateways de dinheiro real
    expect(acoes).toContain('provider: { in: ["MERCADO_PAGO", "INFINITEPAY"] }');
    expect(acoes).toContain('status: "CONFIRMADO"');
  });
  it("só o par DO CATÁLOGO cai junto: clientRef + mesmo instante (janela não basta — a conciliação carimba a data do pedido no cartão)", () => {
    expect(rota).toContain("clientRef !== null");
    expect(rota).toContain("nasceuComOPedido");
    expect(rota).toContain("10 * 60 * 1000");
  });
  it("qualquer outro pedido ligado RECUSA (desvincular ressuscitava o cartão pela conciliação)", () => {
    expect(rota).toContain("exclua ou cancele o pedido na tela Pedidos");
  });
  it("estoque devolvido é empurrado às integrações donas (Nuvemshop/Jueri)", () => {
    expect(rota).toContain("avisarIntegracoesDaDevolucao");
    expect(acoes).toContain("pushStockToNuvemshop");
    expect(acoes).toContain("pushStockToJueri");
  });
  it("o DELETE de pedidos usa as mesmas travas compartilhadas (uma régua só)", () => {
    const pedidos = ler("src/app/api/orders/[id]/route.ts");
    expect(pedidos).toContain("temPagamentoConfirmadoDeGateway");
    expect(pedidos).toContain("avisarIntegracoesDaDevolucao");
  });
});

describe("arrastar para 'Perdido' não pode esconder pedido vivo", () => {
  const rota = ler("src/app/api/opportunities/[id]/route.ts");
  it("cartão com pedido não-cancelado recusa a perda (a reserva não tem prazo)", () => {
    expect(rota).toContain('opp.order.status !== "CANCELADO"');
    expect(rota).toContain("não solta a reserva");
  });
  it("motivo da perda é exigido também no servidor", () => {
    expect(rota).toContain("Informe o motivo da perda.");
  });
  it("sair da coluna de perda limpa o motivo antigo", () => {
    expect(rota).toContain("data.lostReason = null");
  });
});

describe("criar oportunidade respeita a carteira (vendedora só na dela)", () => {
  const rota = ler("src/app/api/opportunities/route.ts");
  it("POST barra cliente de colega, mas deixa o cliente SEM dona (lead da fila)", () => {
    expect(rota).toContain("OR: [{ ownerId: user.id }, { ownerId: null }]");
  });
});

describe("o card do funil não é porta lateral para pedido fora do escopo", () => {
  const pagina = ler("src/app/(app)/funil/page.tsx");
  it("linkedOrders da tela usa orderScope, não só companyId", () => {
    expect(pagina).toContain("...orderScope(user), opportunityId");
  });
  it("pedido escondido pelo escopo ainda SUPRIME a sacola (nada de 'finalize seu pedido' para quem já pediu)", () => {
    expect(pagina).toContain("oppsComPedido");
  });
});

describe("quadro do funil funciona no celular e fala dinheiro em pt-BR", () => {
  const board = ler("src/app/(app)/funil/funnel-board.tsx");
  it("mover por toque existe (drag de HTML5 não dispara no dedo)", () => {
    expect(board).toContain("Etapa da negociação");
    expect(board).toContain("onMove");
  });
  it("valor potencial é lido com numeroBR ('2.500,00' é 2500, não 2,50)", () => {
    expect(board).toContain("numeroBR(value)");
    expect(board).not.toContain('parseFloat(value.replace(",", "."))');
  });
  it("a recusa do servidor chega na tela com a explicação (não um erro genérico)", () => {
    expect(board).toContain("d?.error ??");
  });
});

describe("barra de rolagem das listas internas SEMPRE visível no computador", () => {
  // mesma lição do .cat-scroll (Entre Linhas, 03/08/2026): `scrollbar-width`
  // fora de bloco condicional faz o Chrome ignorar as regras ::-webkit-* e
  // desenhar a barra flutuante que some — foi o que escondeu os cards da
  // coluna "Catálogo enviado" (18/08/2026)
  const css = ler("src/app/globals.css");
  it("regras ::-webkit-* do .thin-scroll existem (é o que força a barra fixa)", () => {
    expect(css).toContain(".thin-scroll::-webkit-scrollbar-thumb");
    expect(css).toContain(".thin-scroll::-webkit-scrollbar-track");
  });
  it("scrollbar-width só em Firefox (@supports) e celular (@media) — nunca global", () => {
    const ocorrencias = css.match(/\.thin-scroll \{[^}]*scrollbar-width/g) ?? [];
    expect(ocorrencias.length).toBe(2);
    expect(css).toContain("@supports not selector(::-webkit-scrollbar)");
    expect(css).toContain("@media (pointer: coarse)");
  });
});

describe("romaneio abre em página do app (não no PDF cru que prende o celular)", () => {
  it("o botão do pedido leva ao visualizador com botão Voltar", () => {
    const pedido = ler("src/app/(app)/pedidos/[id]/page.tsx");
    expect(pedido).toContain("/romaneio`}");
    // o link antigo (PDF cru em target _blank) não pode voltar: no app
    // instalado ele toma a tela sem botão de fechar
    expect(pedido).not.toMatch(/href=\{`\/api\/orders\/\$\{order\.id\}\/pdf`\}/);
  });
  it("o visualizador existe, com Voltar e compartilhar", () => {
    const viewer = ler("src/app/(app)/pedidos/[id]/romaneio/viewer.tsx");
    expect(viewer).toContain("Voltar");
    expect(viewer).toContain("navigator.share");
    // build legacy do pdf.js: celulares mais antigos das lojistas
    expect(viewer).toContain("pdfjs-dist/legacy/build/pdf.mjs");
  });
  it("a página do visualizador aplica o escopo de pedidos (RN de visibilidade)", () => {
    const pagina = ler("src/app/(app)/pedidos/[id]/romaneio/page.tsx");
    expect(pagina).toContain("...orderScope(user)");
  });
});

describe("romaneio imprime em um clique (pedido do dono, 21/08/2026)", () => {
  const viewer = ler("src/app/(app)/pedidos/[id]/romaneio/viewer.tsx");
  it("o botão Imprimir manda o PDF para a impressora sem abrir aba", () => {
    expect(viewer).toContain("Imprimir");
    expect(viewer).toContain("contentWindow?.print()");
  });
  it("navegador que recusa imprimir PDF escondido tem plano B visível", () => {
    // sem isto o clique podia não fazer nada e a lojista ficava sem saída
    expect(viewer).toContain("A janela não abriu?");
    expect(viewer).toContain("Abrir o PDF");
  });
  it("o plano B é LINK para o endereço normal do PDF (pop-up bloqueia janela aberta por código)", () => {
    expect(viewer).not.toContain('window.open(');
  });
});
