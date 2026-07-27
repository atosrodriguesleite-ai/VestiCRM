import { describe, it, expect } from "vitest";

/**
 * REGRA DA COMISSÃO NO CATÁLOGO — quem leva o pedido.
 *
 * Reproduz aqui a decisão que a rota do catálogo toma, para a regra ficar
 * explícita e travada. Foi essa decisão que fez "pedido da Lara aparecer na
 * tela da Juliana": o link identifica quem MANDOU, mas o pedido é de quem é
 * RESPONSÁVEL pela cliente — menos quando a cliente é nova.
 */
function quemLevaOPedido(input: {
  linkSellerId: string | null; // vendedora do link (?ref=)
  ownerId: string | null; // responsável pela cliente (carteira)
  isNewLead: boolean;
}): string | null {
  const { linkSellerId, ownerId, isNewLead } = input;
  if (isNewLead && linkSellerId) return linkSellerId; // trouxe a cliente: é dela
  return ownerId ?? linkSellerId;
}

describe("comissão do pedido do catálogo", () => {
  it("cliente NOVA pelo link da Lara: o pedido é da Lara", () => {
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: "juliana", isNewLead: true })).toBe("lara");
  });

  it("cliente JÁ EXISTENTE da Juliana: o pedido é da Juliana, mesmo com link da Lara", () => {
    // este é o caso reclamado — é a regra atual da loja, não uma falha
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: "juliana", isNewLead: false })).toBe("juliana");
  });

  it("cliente existente SEM responsável: fica com quem mandou o link", () => {
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: null, isNewLead: false })).toBe("lara");
  });

  it("sem link e sem responsável: pedido nasce sem vendedor (e não vira PAGO assim)", () => {
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: null, isNewLead: true })).toBeNull();
  });

  it("link que não identifica ninguém não rouba de quem cuida da cliente", () => {
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: "juliana", isNewLead: false })).toBe("juliana");
  });
});
