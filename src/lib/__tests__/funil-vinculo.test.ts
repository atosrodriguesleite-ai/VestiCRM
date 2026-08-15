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
 * FUNIL VIVO (13/08/2026): pedido sem cartão GANHA um — sempre.
 *
 * O vínculo do bloco acima só reaproveitava negociação existente. Cliente sem
 * negociação aberta (ou cliente de sempre, cujo cartão o intake reaproveitou
 * sem amarrar) gerava pedido SOLTO: pagar não fechava nada e "Pedido fechado"
 * mostrava 7 vendas quando havia muito mais (caso real, 13/08/2026).
 */
describe("funil vivo: pedido sem cartão ganha um", () => {
  const sync = fonte("lib/opportunity-sync.ts");

  it("garantirCartaoDoPedido reaproveita negociação livre ou cria na etapa certa", () => {
    expect(sync).toContain("export async function garantirCartaoDoPedido");
    expect(sync).toContain('status: pago ? "WON" : "OPEN"');
  });
  it("só reaproveita negociação que JÁ EXISTIA quando o pedido nasceu (não rouba a nova)", () => {
    expect(sync).toContain("createdAt: { lte: order.createdAt }");
  });
  it("venda antiga fechada À MÃO no funil é reaproveitada (não dobra o Pedido fechado)", () => {
    expect(sync).toContain("fechadoAMao");
    expect(sync).toContain('status: "WON"');
  });
  it("o fechamento carrega a data REAL do pagamento (não 'hoje')", () => {
    expect(sync).toContain("winLinkedOpportunity(companyId, livre.id, order.paidAt)");
    expect(sync).toContain("closedAt: fechadoEm ?? new Date()");
  });
  it("cartão criado de pedido pago carrega a DATA REAL (paidAt/createdAt)", () => {
    expect(sync).toContain("closedAt: pago ? (order.paidAt ?? new Date()) : null");
    expect(sync).toContain("createdAt: order.createdAt");
  });
  it("corrida não deixa cartão órfão nem pedido com dois cartões", () => {
    expect(sync).toContain("opportunityId: null"); // updateMany condicionado
    expect(sync).toContain("if (amarrado.count === 0)");
  });
  it("pedido CANCELADO sem cartão não inventa perda no passado", () => {
    expect(sync).toContain('if (order.status === "CANCELADO") return null');
  });

  it("pagar fecha o cartão MESMO quando o pedido nasceu solto (settle + status + Nuvemshop)", () => {
    for (const arq of [
      "lib/settle-order.ts",
      "lib/nuvemshop.ts",
      "app/api/orders/[id]/route.ts",
    ]) {
      expect(
        fonte(arq).includes("garantirCartaoDoPedido"),
        `${arq}: pedido pago sem cartão precisa ganhar o seu — sem isso a ` +
          `venda não aparece em "Pedido fechado".`
      ).toBe(true);
    }
  });
  it("criar pedido (sistema e catálogo) garante o cartão no nascimento", () => {
    for (const arq of ["app/api/orders/route.ts", "app/api/catalog/order/route.ts"]) {
      expect(fonte(arq)).toContain(
        "order.opportunityId ?? (await garantirCartaoDoPedido("
      );
    }
  });
  it("a tela do Funil concilia o passado de carona (pedido antigo solto ganha cartão)", () => {
    expect(fonte("app/(app)/funil/page.tsx")).toContain("conciliarFunilComPedidos");
    expect(sync).toContain("export async function conciliarFunilComPedidos");
    expect(sync).toContain("take: 40"); // rodada limitada: nunca pesa a tela
    // sem etapa de ganho, sai barato — senão varria os mesmos pedidos para sempre
    expect(sync).toContain("if (!temGanho) return");
  });
  it("pedido do catálogo também ANDA o cartão (não fica em Primeiro contato com pedido)", () => {
    const rota = fonte("app/api/catalog/order/route.ts");
    expect(rota).toContain("avancarFunil(");
  });
  it("cliente abriu o catálogo sem negociação → cartão NASCE em Catálogo enviado", () => {
    expect(fonte("lib/tracking/engine.ts")).toContain("nascerCartaoDoCatalogo");
    const auto = fonte("lib/funil-auto.ts");
    expect(auto).toContain("export async function nascerCartaoDoCatalogo");
    expect(auto).toContain('nomeCasaComEtapa(e.name, "CATALOGO_ENVIADO")');
    expect(auto).toContain("if (aberta) return"); // com negociação aberta, não duplica
  });
  it("abrir catálogo respeita a política da loja e a corrida do clique duplo", () => {
    const auto = fonte("lib/funil-auto.ts");
    expect(auto).toContain('intakeOppPolicy === "NUNCA"');
    expect(auto).toContain("abertas[0]?.id !== criada.id"); // sobrevive a mais antiga
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
