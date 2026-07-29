import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * REGRA DO FUNIL: TODO pedido gruda na negociação da cliente.
 *
 * O motor de `opportunity-sync` (ganhar, perder, reabrir, atualizar valor)
 * desiste na primeira linha quando o pedido não tem `opportunityId`. Durante
 * muito tempo SÓ o pedido do catálogo era ligado — pedido montado no chat ou
 * na tela de Pedidos (o caminho principal do atacado) nascia solto. A
 * vendedora fechava a venda, recebia o pagamento, e o cartão continuava
 * parado em "em negociação" para sempre. Era o motivo de o funil parecer
 * inútil e ninguém alimentar.
 *
 * Este teste vigia os TRÊS caminhos que criam pedido. Se alguém criar um
 * quarto (ou remover o vínculo de um existente), ele quebra e explica.
 */

const raiz = join(process.cwd(), "src");

const CAMINHOS_QUE_CRIAM_PEDIDO = [
  { arquivo: "app/api/orders/route.ts", nome: "pedido montado no sistema/chat" },
  { arquivo: "app/api/catalog/order/route.ts", nome: "pedido do catálogo público" },
  { arquivo: "lib/nuvemshop.ts", nome: "venda paga da loja online" },
];

function fonte(arquivo: string): string {
  return readFileSync(join(raiz, arquivo), "utf8");
}

describe("todo pedido gruda na negociação do funil", () => {
  for (const { arquivo, nome } of CAMINHOS_QUE_CRIAM_PEDIDO) {
    it(`${nome} preenche opportunityId`, () => {
      expect(
        /opportunityId/.test(fonte(arquivo)),
        `${arquivo} cria pedido sem ligar na negociação. Sem esse vínculo o ` +
          `cartão do funil nunca fecha sozinho: a venda acontece e a ` +
          `negociação fica aberta para sempre (o opportunity-sync sai na ` +
          `primeira linha quando o vínculo é nulo).`
      ).toBe(true);
    });
  }

  it("venda da loja online fecha o cartão (não passa por transição de status)", () => {
    expect(
      /winLinkedOpportunity/.test(fonte("lib/nuvemshop.ts")),
      `O pedido da Nuvemshop já nasce PAGO e não passa pela troca de status, ` +
        `então o fechamento do cartão precisa ser chamado na própria ingestão. ` +
        `Sem isso, a cliente que abandonou o carrinho e DEPOIS comprou fica ` +
        `com o cartão aberto — e alguém vai cobrar quem já pagou.`
    ).toBe(true);
  });
});

/**
 * REGRA DA TELA: o quadro do funil obedece o servidor.
 *
 * O estado nascia de `useState(initialStages)` e nunca mais olhava para a
 * prop. Como `router.refresh()` re-renderiza o servidor mas PRESERVA o estado
 * do componente, a tela mentia: cartão que o servidor recusou continuava na
 * coluna nova, e oportunidade recém-criada não aparecia.
 */
describe("o quadro do funil não mente", () => {
  const board = fonte("app/(app)/funil/funnel-board.tsx");

  it("sincroniza o estado com o que vem do servidor", () => {
    expect(
      /useEffect\(\s*\(\)\s*=>\s*\{\s*setStages\(initialStages\)/.test(board),
      `Sem sincronizar 'initialStages', o quadro nunca se corrige: um cartão ` +
        `movido que o servidor recusou fica na coluna errada até o F5.`
    ).toBe(true);
  });

  it("desfaz o movimento quando o servidor recusa", () => {
    expect(
      /setStages\(anterior\)/.test(board),
      `O movimento é otimista: se a chamada falhar (4G oscilando) e não houver ` +
        `rollback, a tela mostra a venda fechada e o banco continua com a ` +
        `negociação aberta. Ninguém cobra a cliente.`
    ).toBe(true);
  });

  it("não usa window.prompt para o motivo da perda", () => {
    // procura a CHAMADA (com parêntese) — os comentários deste arquivo citam
    // o nome para explicar o problema, e não podem derrubar o teste
    expect(
      /window\.prompt\s*\(/.test(board),
      `window.prompt não funciona em vários navegadores de celular — onde a ` +
        `lojista trabalha —, e o cartão era perdido sem motivo. Texto livre ` +
        `também inutiliza o relatório ("preço", "Preço" e "achou caro" viram ` +
        `três barras diferentes). Use a lista de motivos.`
    ).toBe(false);
  });
});
