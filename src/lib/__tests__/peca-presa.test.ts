import { describe, it, expect, vi } from "vitest";
import type { OrderStatus } from "@prisma/client";
import { avisoDaRemocao, fraseDaPecaPresa, travaARemocao, type PedidoQueSegura } from "../estoque/peca-presa";

vi.mock("../db", () => ({ db: {} }));
const { STATUS_QUE_SEGURAM_NA_LOJA } = await import("../estoque/inventario");

/**
 * A VARIAÇÃO QUE NÃO SE REMOVE DIZ QUAL PEDIDO A SEGURA (RN-050).
 *
 * Relato do dono (25/09/2026): a lojista tinha vários pedidos abertos e a
 * recusa dizia só "cancele ou conclua O pedido" — sem dizer qual. A frase
 * agora nomeia o pedido; o de colega (fora do recorte, RN-007) só conta.
 */

const ROTULO = "Legging · Café · Único";
const p = (x: Partial<PedidoQueSegura>): PedidoQueSegura => ({
  numero: 482,
  status: "AGUARDANDO_PAGAMENTO",
  cliente: "Maria Silva",
  pecas: 2,
  visivel: true,
  ...x,
});

describe("a recusa de remover a variação diz qual pedido a segura", () => {
  it("um pedido: número, cliente, situação e quantas peças", () => {
    const f = fraseDaPecaPresa(ROTULO, 2, [p({})]);
    expect(f).toContain("no pedido #482 (Maria Silva, aguardando pagamento, 2 peças)");
    expect(f).toContain("tire a peça desse pedido");
  });

  it("vários pedidos, em ordem de número", () => {
    const f = fraseDaPecaPresa(ROTULO, 3, [
      p({ numero: 490, cliente: "Ana", pecas: 1, status: "ORCAMENTO" }),
      p({ numero: 482, pecas: 2 }),
    ]);
    expect(f).toContain("nos pedidos #482 (Maria Silva, aguardando pagamento, 2 peças) e #490 (Ana, orçamento, 1 peça)");
    expect(f).toContain("desses pedidos");
  });

  it("pedido de colega (fora do recorte da vendedora) só entra na conta — sem número nem cliente", () => {
    const f = fraseDaPecaPresa(ROTULO, 3, [
      p({ numero: 482 }),
      p({ numero: 777, cliente: "Cliente da Colega", visivel: false }),
    ]);
    expect(f).toContain("#482");
    expect(f).toContain("1 pedido de colega");
    expect(f).not.toContain("777");
    expect(f).not.toContain("Cliente da Colega");
  });

  it("só pedidos de colegas: diz quantos, sem nenhum número", () => {
    const f = fraseDaPecaPresa(ROTULO, 4, [p({ visivel: false }), p({ numero: 9, visivel: false })]);
    expect(f).toContain("2 pedidos de colegas");
    expect(f).not.toMatch(/#\d/);
  });

  it("muitos pedidos: nomeia os 5 primeiros e diz quantos faltam", () => {
    const muitos = Array.from({ length: 8 }, (_, i) => p({ numero: 100 + i, pecas: 1 }));
    const f = fraseDaPecaPresa(ROTULO, 8, muitos);
    expect(f).toContain("#104");
    expect(f).not.toContain("#105");
    expect(f).toContain("mais 3 pedidos");
  });

  it("a saída dita é tirar a peça ou cancelar — e que pedido pago não impede", () => {
    const f = fraseDaPecaPresa(ROTULO, 2, [p({})]);
    expect(f).toContain("cancele devolvendo as peças");
    expect(f).toContain("Pedido já pago não impede");
    // "marque como enviado" era a saída para pedido pago, que não trava mais
    expect(f).not.toContain("enviado");
  });

  it("lista vazia (defensivo): frase genérica, sem inventar número", () => {
    expect(fraseDaPecaPresa(ROTULO, 2, [])).toBe(
      `${ROTULO} tem 2 peça(s) reservada(s) em pedido ainda não pago. Tire a peça do pedido ou cancele-o antes de remover.`
    );
  });
});

describe("pedido já VENDIDO não trava a remoção da variação", () => {
  // relato do dono (25/09/2026): os pedidos que seguravam a peça estavam em
  // SEPARAÇÃO — "separação já vendeu, então não pode segurar"
  it("separação, pago e em produção: é venda, não trava", () => {
    expect(travaARemocao("SEPARACAO")).toBe(false);
    expect(travaARemocao("PAGO")).toBe(false);
    expect(travaARemocao("EM_PRODUCAO")).toBe(false);
  });

  it("orçamento e aguardando pagamento: a reserva é a promessa da peça, trava", () => {
    expect(travaARemocao("ORCAMENTO")).toBe(true);
    expect(travaARemocao("AGUARDANDO_PAGAMENTO")).toBe(true);
  });

  it("entre os status que seguram peça na loja, travam EXATAMENTE os que não são venda", () => {
    // a consulta filtra pelos que seguram; a régua pura decide quem trava —
    // status novo na lista de venda (RN-001) sai da trava sozinho
    const travam = STATUS_QUE_SEGURAM_NA_LOJA.filter((s) => travaARemocao(s as OrderStatus));
    expect([...travam].sort()).toEqual(["AGUARDANDO_PAGAMENTO", "ORCAMENTO"]);
  });
});

describe("quem removeu fica sabendo dos pedidos em aberto que tinham a peça", () => {
  it("nenhum pedido: nada a dizer", () => {
    expect(avisoDaRemocao([])).toBeNull();
  });

  it("um pedido: número, o que muda na separação e no cancelamento", () => {
    const a = avisoDaRemocao([{ numero: 1011, visivel: true }])!;
    expect(a).toContain("O pedido #1011 continua com a peça");
    expect(a).toContain("conferir na mão");
    expect(a).toContain("não volta sozinha ao estoque");
  });

  it("vários, em ordem; o de colega (RN-007) só conta", () => {
    const a = avisoDaRemocao([
      { numero: 1156, visivel: true },
      { numero: 1011, visivel: true },
      { numero: 999, visivel: false },
    ])!;
    expect(a).toContain("Os pedidos #1011, #1156 e 1 de colega continuam");
    expect(a).not.toContain("999");
  });
});
