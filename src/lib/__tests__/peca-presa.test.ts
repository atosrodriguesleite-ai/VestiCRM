import { describe, it, expect } from "vitest";
import { fraseDaPecaPresa, type PedidoQueSegura } from "../estoque/peca-presa";

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

  it("corrida rara (ninguém mais segura na hora de perguntar): a frase de antes, sem inventar", () => {
    expect(fraseDaPecaPresa(ROTULO, 2, [])).toBe(
      `${ROTULO} tem 2 peça(s) reservada(s) em pedido. Cancele ou conclua o pedido antes de remover.`
    );
  });
});
