import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { podeTransferirVenda } from "../orders";

// Guarda RN-005 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * REGRA DA COMISSÃO NO CATÁLOGO — quem leva o pedido.
 *
 * QUEM MANDA O LINK LEVA A VENDA, e SÓ ele. A cliente chega no WhatsApp, a
 * vendedora manda o link dela, a cliente monta o pedido: aquele pedido é
 * dessa vendedora e aparece no painel dela. A carteira acompanha.
 *
 * NÃO existe desvio para a "responsável pela cliente". Existia, e era ele que
 * fazia o pedido nascido do link da Lara cair no painel da Juliana só porque
 * a cliente estava na carteira da Juliana — o dono da loja apontou que isso
 * não faz sentido nenhum, e tem razão: painel de vendedora é o espelho dos
 * links dela.
 *
 * Sem vendedora no link, o pedido nasce SEM DONA (é da loja). Ele não vira
 * PAGO enquanto alguém não assumir — regra que já existia e que fecha o
 * ciclo: ninguém ganha comissão de venda que não fez, e nenhuma venda fica
 * sem responsável na hora de faturar.
 */
function quemLevaOPedido(input: {
  linkSellerId: string | null; // vendedora identificada no link (?ref=)
  ownerId: string | null; // responsável pela cliente (carteira) — NÃO decide
}): string | null {
  return input.linkSellerId;
}

/** A carteira segue a venda: quem vendeu passa a cuidar da cliente. */
function novaResponsavel(input: {
  linkSellerId: string | null;
  ownerId: string | null;
}): string | null {
  return input.linkSellerId ?? input.ownerId;
}

describe("quem manda o link leva — e só ele", () => {
  it("cliente da Juliana pede pelo link da Lara: a venda é da LARA", () => {
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: "juliana" })).toBe("lara");
  });

  it("e a cliente passa a ser da Lara (carteira acompanha a venda)", () => {
    expect(novaResponsavel({ linkSellerId: "lara", ownerId: "juliana" })).toBe("lara");
  });

  it("cliente nova pelo link da Lara: é da Lara", () => {
    expect(quemLevaOPedido({ linkSellerId: "lara", ownerId: null })).toBe("lara");
  });
});

describe("sem vendedora no link, a venda é DA LOJA (nunca da carteira)", () => {
  it("link geral do catálogo: não cai no painel de ninguém", () => {
    // era isto que sujava o painel: o pedido ia para a dona da carteira
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: "juliana" })).toBeNull();
  });

  it("link que não identifica ninguém também fica com a loja", () => {
    // nome que não bate, ou duas pessoas com o mesmo primeiro nome
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: "lara" })).toBeNull();
  });

  it("sem link e sem carteira: igual — sem dona", () => {
    expect(quemLevaOPedido({ linkSellerId: null, ownerId: null })).toBeNull();
  });

  it("mas a carteira da cliente NÃO muda quando não houve link", () => {
    // a cliente continua com quem já era: sem venda nova, sem troca de dona
    expect(novaResponsavel({ linkSellerId: null, ownerId: "juliana" })).toBe("juliana");
  });
});

describe("a regra está no código, não só no teste", () => {
  const rota = readFileSync(
    join(process.cwd(), "src/app/api/catalog/order/route.ts"),
    "utf8"
  );

  it("o pedido do catálogo é atribuído SÓ pelo link", () => {
    expect(rota).toContain("const orderSellerId: string | null = linkSellerId;");
  });

  it("nenhum desvio para a responsável pela cliente sobrou", () => {
    expect(rota).not.toMatch(/orderSellerId\s*=\s*linkSellerId\s*\?\?/);
  });

  it("pedido sem vendedora avisa que a venda é da loja", () => {
    expect(rota).toContain("a venda é da loja");
    expect(rota).toContain("antes de marcar como pago");
  });
});

describe("venda da Nuvemshop não tem vendedora — e não pode ganhar uma", () => {
  // Decisão do dono (28/08/2026): loja online não gera comissão. Atribuir
  // vendedora depois faria a venda entrar na comissão e na meta de quem não
  // a atendeu — nem o admin pode.
  const admin = { id: "a1", role: "ADMIN" };
  const gerente = { id: "g1", role: "MANAGER" };

  it("nem admin nem gerência transferem venda da loja online", () => {
    const vendaOnline = { sellerId: null, source: "NUVEMSHOP" };
    expect(podeTransferirVenda(admin, vendaOnline)).toBe(false);
    expect(podeTransferirVenda(gerente, vendaOnline)).toBe(false);
  });

  it("pedido normal sem dona segue transferível pela gerência (nada mudou)", () => {
    expect(podeTransferirVenda(admin, { sellerId: null, source: "CATALOGO" })).toBe(true);
    expect(podeTransferirVenda(gerente, { sellerId: null })).toBe(true);
  });

  it("as duas portas recusam com a mensagem específica, e o PAGO tem a exceção", () => {
    const patch = readFileSync(
      join(process.cwd(), "src/app/api/orders/[id]/route.ts"),
      "utf8"
    );
    const transferir = readFileSync(
      join(process.cwd(), "src/app/api/orders/[id]/transferir/route.ts"),
      "utf8"
    );
    expect(patch).toContain("não gera comissão — não dá para atribuir");
    expect(transferir).toContain("não gera comissão — não dá para transferir");
    // sem a exceção, pedido Nuvemshop cancelado nunca mais reabriria (a trava
    // do PAGO exigiria a vendedora que ele não pode ter)
    expect(patch).toContain("enteringPaid && !vendaOnline(order)");
  });

  it("o legado NÃO fica preso: gerência pode REMOVER a vendedora atribuída antes da regra", () => {
    // sem isso, venda online que ganhou vendedora antes de 28/08/2026
    // geraria comissão indevida PARA SEMPRE, sem ninguém poder corrigir
    const patch = readFileSync(
      join(process.cwd(), "src/app/api/orders/[id]/route.ts"),
      "utf8"
    );
    expect(patch).toContain("Remover a vendedora de uma venda da loja online é da gerência");
    // e a trava "pago precisa de vendedor" não pode barrar essa remoção
    expect(patch).toMatch(/PAID_STATUSES\.has\(parsed\.data\.status \?\? order\.status\) &&\s*\n[^\n]*\n[^\n]*\n\s*!vendaOnline\(order\)/);
  });

  it("a pergunta \"é venda online?\" tem um dono só (vendaOnline em lib/orders)", () => {
    // o discriminador repetido à mão em 7 lugares era 7 chances de esquecer
    // um quando o canal mudar — a regra mora no motor
    const motor = readFileSync(join(process.cwd(), "src/lib/orders.ts"), "utf8");
    expect(motor).toContain("export function vendaOnline");
  });
});
