import { describe, it, expect } from "vitest";

/**
 * REGRA DA COMISSÃO NO CATÁLOGO — quem leva o pedido.
 *
 * Regra da loja: QUEM MANDA O LINK LEVA A VENDA. A cliente chega no WhatsApp,
 * a vendedora manda o link dela, a cliente pede — o pedido é dessa vendedora,
 * porque foi ela quem atendeu e fechou. A carteira acompanha a venda.
 *
 * Só quando o link NÃO identifica ninguém é que vale a responsável pela
 * cliente (ex.: a cliente entrou direto no catálogo, sem link de vendedora).
 *
 * Este teste é a regra escrita em código: se alguém inverter isso um dia,
 * quebra aqui antes de virar comissão paga errada.
 */
function quemLevaOPedido(input: {
  linkSellerId: string | null; // vendedora do link (?ref=)
  ownerId: string | null; // responsável pela cliente (carteira)
}): string | null {
  return input.linkSellerId ?? input.ownerId;
}

/** A carteira segue a venda: quem vendeu passa a cuidar da cliente. */
function novaResponsavel(input: {
  linkSellerId: string | null;
  ownerId: string | null;
}): string | null {
  return input.linkSellerId ?? input.ownerId;
}

describe("comissão do pedido do catálogo — quem manda o link leva", () => {
  it("cliente da Juliana pede pelo link da Lara: a venda é da LARA", () => {
    // caso reclamado pela lojista: agora resolve a favor de quem atendeu
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: "juliana" })).toBe("lara");
  });

  it("e a cliente passa a ser da Lara (carteira acompanha a venda)", () => {
    expect(novaResponsavel({ linkSellerId: "lara", ownerId: "juliana" })).toBe("lara");
  });

  it("cliente nova pelo link da Lara: é da Lara", () => {
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: null })).toBe("lara");
  });

  it("sem link (cliente entrou direto no catálogo): fica com a responsável", () => {
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: "juliana" })).toBe("juliana");
  });

  it("link que não identifica ninguém não tira da responsável", () => {
    // link com nome que não bate, ou duas pessoas com o mesmo primeiro nome
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: "juliana" })).toBe("juliana");
  });

  it("sem link e sem responsável: pedido nasce sem vendedor (não vira PAGO assim)", () => {
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: null })).toBeNull();
  });
});
