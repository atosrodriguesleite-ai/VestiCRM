import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ehDaCampanha, whereDaCampanha } from "../campanha-pedidos";

// Guarda RN-042 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * DO NÚMERO ATÉ O PEDIDO — relato do dono (01/09/2026):
 *
 *   "aqui fala que tive um pedido vindo da campanha, não localizei esse
 *    pedido"
 *
 * O cartão contava certo e não levava a lugar nenhum: nada na lista de
 * Pedidos dizia de qual campanha o pedido veio, e o número não era clicável.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("um pedido é da campanha por dois caminhos", () => {
  const sessoes = new Set(["s1", "s2"]);

  it("pelo carimbo do pedido (RN-040)", () => {
    expect(
      ehDaCampanha({ campaignRef: "grupo-vip", trackSessionId: null }, "grupo-vip", sessoes)
    ).toBe(true);
  });

  /**
   * O carimbo só existe em pedido feito DEPOIS que ele passou a ser gravado.
   * Sem o caminho da sessão, o histórico da loja sumiria da tela justamente
   * na primeira vez que ela fosse procurar.
   */
  it("pela sessão de navegação — é assim que o pedido ANTIGO é achado", () => {
    expect(
      ehDaCampanha({ campaignRef: null, trackSessionId: "s2" }, "grupo-vip", sessoes)
    ).toBe(true);
  });

  it("pedido de outra campanha (ou de campanha nenhuma) fica de fora", () => {
    expect(
      ehDaCampanha({ campaignRef: "outra", trackSessionId: "s9" }, "grupo-vip", sessoes)
    ).toBe(false);
    expect(
      ehDaCampanha({ campaignRef: null, trackSessionId: null }, "grupo-vip", sessoes)
    ).toBe(false);
  });
});

describe("a consulta da lista de Pedidos", () => {
  it("procura pelos dois caminhos", () => {
    const w = whereDaCampanha("grupo-vip", ["s1"]);
    expect(w.status).toEqual({ not: "CANCELADO" });
    expect(w.OR).toEqual([
      { campaignRef: "grupo-vip" },
      { trackSessionId: { in: ["s1"] } },
    ]);
  });

  /**
   * `in: []` é um filtro que não filtra — numa refatoração futura viraria
   * "sem filtro" e a lista traria a loja inteira como se fossem da campanha.
   */
  it("campanha sem nenhuma sessão devolve lista VAZIA, nunca a loja inteira", () => {
    const w = whereDaCampanha("grupo-vip", []);
    expect(w.OR).toEqual([
      { campaignRef: "grupo-vip" },
      { trackSessionId: { in: ["sem-sessao"] } },
    ]);
  });
});

describe("o número leva ao pedido", () => {
  it("o cartão da campanha linka para a lista filtrada", () => {
    const tela = ler("src/app/(app)/inteligencia/links-manager.tsx");
    expect(tela).toContain("/pedidos?campanha=");
  });

  /**
   * O contador e a lista TÊM que usar a mesma régua: número que não bate com
   * a lista deixaria a lojista procurando de novo — que é o problema inteiro.
   */
  it("contador e lista usam a MESMA régua", () => {
    expect(ler("src/lib/tracking/insights.ts")).toContain("ehDaCampanha(");
    expect(ler("src/app/(app)/pedidos/page.tsx")).toContain("whereDaCampanha(");
  });

  /**
   * Contar SESSÃO convertida em vez de PEDIDO fazia a campanha exibir um
   * pedido que já tinha sido excluído — número sem pedido é exatamente o que
   * o dono foi procurar e não achou.
   */
  it("conta PEDIDO, não sessão marcada como convertida", () => {
    const fonte = ler("src/lib/tracking/insights.ts");
    const de = fonte.indexOf("export async function campaignRanking");
    const ate = fonte.indexOf("export async function", de + 10);
    const trecho = fonte.slice(de, ate);
    expect(trecho).toContain("db.order.findMany");
    expect(trecho).not.toContain("mine.filter((s) => s.converted)");
  });

  /**
   * O contador e a lista precisam olhar a MESMA janela: sem o recorte, o
   * pedido achado pelo carimbo vinha de qualquer época e o cartão dizia
   * "0 cliques · 10 pedidos" no filtro de hoje.
   */
  it("o pedido carimbado conta na janela do período", () => {
    const fonte = ler("src/lib/tracking/insights.ts");
    const de = fonte.indexOf("export async function campaignRanking");
    const trecho = fonte.slice(de, fonte.indexOf("export async function", de + 10));
    expect(trecho).toContain("janela-atribuicao-ok");
    expect(trecho).toContain("createdAt: { gte: p.from, lte: p.to }");
  });

  /**
   * O faturamento sai dos MESMOS pedidos que o contador conta: somar só o que
   * veio por sessão deixava o pedido do resgate "Colar pedido do WhatsApp"
   * (que não tem sessão) eternamente como "aguardando pagamento", mesmo pago.
   */
  it("faturamento e contagem olham o mesmo conjunto de pedidos", () => {
    const fonte = ler("src/lib/tracking/insights.ts");
    const de = fonte.indexOf("export async function campaignRanking");
    const trecho = fonte.slice(de, fonte.indexOf("export async function", de + 10));
    // o faturamento sai do MESMO `orders` do contador, não de um mapa por
    // sessão (descrever o conjunto, não o formato da linha)
    expect(trecho).toContain("PAID_ORDER_STATUSES");
    expect(trecho).not.toContain("pagoPorSessao");
  });

  /**
   * O cartão conta o período escolhido; o link precisa abrir a lista NO MESMO
   * período, senão o cartão diz 2 e a lista mostra 40 (revisão de
   * 01/09/2026).
   */
  it("o link leva o período do cartão junto", () => {
    expect(ler("src/app/(app)/inteligencia/links-manager.tsx")).toContain("&de=${periodo.de}");
    expect(ler("src/app/(app)/inteligencia/page.tsx")).toContain("periodo={{");
  });

  /**
   * Endereço de campanha que não existe (link velho, campanha excluída) não
   * pode virar "a loja inteira" em silêncio: a lojista leria pedido de outra
   * origem como resultado da campanha.
   */
  it("campanha inexistente mostra aviso, não a loja inteira", () => {
    const tela = ler("src/app/(app)/pedidos/page.tsx");
    expect(tela).toContain("campanha-inexistente");
    expect(tela).toContain("Não existe campanha com o endereço");
  });

  /** Pedido cancelado não é venda da campanha. */
  it("pedido CANCELADO não entra na conta da campanha", () => {
    expect(ler("src/lib/tracking/insights.ts")).toContain('o.status !== "CANCELADO"');
  });

  /**
   * `converted` é gravado em best-effort (`.catch(() => {})` na rota do
   * pedido): depender dele faria um pedido PAGO sumir da conta e da lista por
   * causa de uma marca que falhou.
   */
  it("a busca por visita NÃO depende da marca de conversão", () => {
    expect(ler("src/lib/tracking/insights.ts")).not.toContain(
      "sessions.filter((s) => s.converted).map"
    );
    const tela = ler("src/app/(app)/pedidos/page.tsx");
    const de = tela.indexOf("db.trackSession.findMany");
    expect(tela.slice(de, de + 260)).not.toContain("converted: true");
  });

  /** URL torta não derruba a tela (mesma lição do `?ref=a&ref=b`). */
  it("parâmetro repetido não quebra a lista", () => {
    const tela = ler("src/app/(app)/pedidos/page.tsx");
    expect(tela).toContain("Array.isArray(campanhaRaw)");
  });

  /** O recorte da campanha vale também nos números dos chips e no total. */
  it("os contadores da tela respeitam o filtro de campanha", () => {
    const tela = ler("src/app/(app)/pedidos/page.tsx");
    // as três contagens (status, canal, sem vendedora) passam pelo mesmo funil
    expect(tela.match(/comCampanha\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  /** Filtrar por período não pode derrubar o recorte da campanha. */
  it("o filtro de período leva a campanha junto", () => {
    const tela = ler("src/app/(app)/pedidos/page.tsx");
    expect(tela).toContain('name="campanha"');
  });

  /** Filtro sem saída assusta: a faixa diz o que é e como voltar. */
  it("a tela diz que está filtrada e como sair", () => {
    const tela = ler("src/app/(app)/pedidos/page.tsx");
    expect(tela).toContain("Ver todos os pedidos");
  });
});

/**
 * O PEDIDO FANTASMA — a causa raiz do relato.
 *
 * O pedido do catálogo marca `TrackSession.converted` ao nascer, e apagar o
 * pedido NUNCA desmarcava. Resultado: a campanha seguia anunciando uma venda
 * que não existe mais, o funil contava "enviou pedido" e — o pior — a
 * recuperação parava de procurar aquela cliente, achando que ela já tinha
 * comprado.
 */
describe("excluir pedido desfaz a marca de venda da visita", () => {
  const fonte = ler("src/lib/order-actions.ts");

  it("a visita deixa de contar como convertida", () => {
    expect(fonte).toContain("converted: false");
  });

  /**
   * Duas sacolas na mesma visita são raras, mas apagar uma não pode apagar a
   * prova da outra.
   */
  it("só desmarca quando não sobrou nenhum outro pedido daquela visita", () => {
    const trecho = fonte.slice(fonte.indexOf("order.trackSessionId"));
    expect(trecho).toContain("tx.order.count");
    expect(trecho).toContain("aindaTem === 0");
  });

  /**
   * `Order.trackSessionId` não tem chave estrangeira: a sessão pode já ter
   * sumido, e um `update` que não acha a linha derrubaria a transação —
   * deixando o pedido IMPOSSÍVEL de excluir (revisão de 01/09/2026).
   */
  it("sessão que já sumiu não impede a exclusão do pedido", () => {
    expect(fonte).toContain("tx.trackSession.updateMany");
    expect(fonte).toContain("companyId: order.companyId");
  });

  /**
   * No funil ÚNICO de exclusão, e DENTRO da transação: o pedido também é
   * apagado pela tela do funil de vendas, e promessa solta depois da
   * resposta seria congelada pela Vercel (a lição da RN-033).
   */
  it("vale para as duas portas de exclusão, dentro da transação", () => {
    expect(fonte).toContain("tx.trackSession.update");
    for (const porta of [
      "src/app/api/orders/[id]/route.ts",
      "src/app/api/opportunities/[id]/route.ts",
    ]) {
      expect(ler(porta)).toContain("reverseAndDeleteOrder");
    }
  });
});
