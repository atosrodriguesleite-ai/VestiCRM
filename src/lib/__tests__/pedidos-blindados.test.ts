import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { liquidoDosMovimentos } from "../estoque-do-pedido";
import { reservarOQueTiver } from "../reservations";
import { ehCorridaDeNumero, comNumeroUnico } from "../numero-do-pedido";

/**
 * BLINDAGENS DO MÓDULO PEDIDOS (auditoria preventiva de 05/08/2026).
 *
 * Seis achados graves, uma raiz comum: dinheiro e estoque mexidos sem
 * transação, sem trava de corrida e devolvendo pela quantidade do ITEM em
 * vez do que realmente saiu. Estes testes guardam as regras novas:
 *
 *  1. devolução de estoque = LIVRO DE MOVIMENTOS (saiu − voltou), nunca a
 *     quantidade do item;
 *  2. reserva parcial grava movimento só do que FOI segurado;
 *  3. corrida de número de pedido → INSISTIR (e só nela);
 *  4. mudança de status / liquidação de Pix são transacionais com trava;
 *  5. webhook que falha responde ERRO (para o gateway reenviar).
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ---------------------------------------------------------------------------
describe("devolução pelo livro de movimentos (o que SAIU de verdade)", () => {
  it("saiu − voltou, por variação; só positivos ficam", () => {
    const net = liquidoDosMovimentos([
      { variantId: "a", type: "SAIDA", quantity: 10 },
      { variantId: "a", type: "ENTRADA", quantity: 4 },
      { variantId: "b", type: "SAIDA", quantity: 2 },
    ]);
    expect(net.get("a")).toBe(6);
    expect(net.get("b")).toBe(2);
  });

  it("depois de devolver tudo, o líquido zera — devolver de novo devolve NADA (idempotente)", () => {
    const net = liquidoDosMovimentos([
      { variantId: "a", type: "SAIDA", quantity: 5 },
      { variantId: "a", type: "ENTRADA", quantity: 5 },
    ]);
    expect(net.size).toBe(0);
  });

  it("AJUSTE manual não pertence ao pedido e fica fora da conta", () => {
    const net = liquidoDosMovimentos([
      { variantId: "a", type: "SAIDA", quantity: 3 },
      { variantId: "a", type: "AJUSTE", quantity: 100 },
      { variantId: null, type: "SAIDA", quantity: 9 },
    ]);
    expect(net.get("a")).toBe(3);
    expect(net.size).toBe(1);
  });

  it("a exclusão e o cancelamento usam o livro, não a quantidade do item", () => {
    expect(ler("src/lib/order-actions.ts")).toContain("baixasLiquidasDoPedido");
    expect(ler("src/app/api/orders/[id]/route.ts")).toContain(
      "devolverEstoqueDoPedido"
    );
  });
});

// ---------------------------------------------------------------------------
describe("reserva parcial: o movimento gravado é o que FOI segurado", () => {
  /** banco de mentira: um mapa de estoque com a baixa condicionada real */
  function bancoComEstoque(estoque: Record<string, number>) {
    return {
      productVariant: {
        updateMany: async (args: {
          where: { id: string; stock: { gte: number } };
          data: { stock: { decrement: number } };
        }) => {
          const atual = estoque[args.where.id] ?? 0;
          if (atual < args.where.stock.gte) return { count: 0 };
          estoque[args.where.id] = atual - args.data.stock.decrement;
          return { count: 1 };
        },
        findUnique: async (args: { where: { id: string } }) => ({
          stock: estoque[args.where.id] ?? 0,
        }),
      },
    };
  }

  it("pediu 10, havia 4: segura 4 (não 10) e anota a falta", async () => {
    const estoque = { v1: 4 };
    const r = await reservarOQueTiver(bancoComEstoque(estoque), [
      { variantId: "v1", quantity: 10, label: "Blusa (Preto M)" },
    ]);
    expect(r.seguradas).toEqual([{ variantId: "v1", quantity: 4 }]);
    expect(r.faltas).toEqual([
      { label: "Blusa (Preto M)", pedido: 10, disponivel: 4 },
    ]);
    expect(estoque.v1).toBe(0);
  });

  it("tinha tudo: segura a quantidade cheia, sem falta", async () => {
    const r = await reservarOQueTiver(bancoComEstoque({ v1: 8 }), [
      { variantId: "v1", quantity: 5, label: "Blusa" },
    ]);
    expect(r.seguradas).toEqual([{ variantId: "v1", quantity: 5 }]);
    expect(r.faltas).toEqual([]);
  });

  it("esgotado: nada segurado, falta anotada", async () => {
    const r = await reservarOQueTiver(bancoComEstoque({ v1: 0 }), [
      { variantId: "v1", quantity: 3, label: "Blusa" },
    ]);
    expect(r.seguradas).toEqual([]);
    expect(r.faltas).toEqual([{ label: "Blusa", pedido: 3, disponivel: 0 }]);
  });

  it("catálogo e liquidação de Pix gravam movimento pelas SEGURADAS", () => {
    expect(ler("src/app/api/catalog/order/route.ts")).toContain(
      "reserva.seguradas"
    );
    expect(ler("src/lib/settle-order.ts")).toContain("seguradas.map");
  });
});

// ---------------------------------------------------------------------------
describe("corrida do número do pedido: perder = tentar de novo", () => {
  const corrida = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "6.0.0",
    meta: { target: ["companyId", "number"] },
  });
  const protocoloDuplicado = new Prisma.PrismaClientKnownRequestError(
    "Unique constraint",
    {
      code: "P2002",
      clientVersion: "6.0.0",
      meta: { target: ["companyId", "clientRef"] },
    }
  );

  it("só a corrida DE NÚMERO é reconhecida", () => {
    expect(ehCorridaDeNumero(corrida)).toBe(true);
    // o P2002 do protocolo do catálogo tem tratamento próprio (idempotência)
    expect(ehCorridaDeNumero(protocoloDuplicado)).toBe(false);
    expect(ehCorridaDeNumero(new Error("qualquer coisa"))).toBe(false);
  });

  it("perdeu a corrida uma vez, ganha na segunda", async () => {
    let chamadas = 0;
    const criado = await comNumeroUnico(async () => {
      chamadas++;
      if (chamadas === 1) throw corrida;
      return "pedido-42";
    });
    expect(criado).toBe("pedido-42");
    expect(chamadas).toBe(2);
  });

  it("outros erros sobem intactos, sem repetir a criação", async () => {
    let chamadas = 0;
    await expect(
      comNumeroUnico(async () => {
        chamadas++;
        throw protocoloDuplicado;
      })
    ).rejects.toBe(protocoloDuplicado);
    expect(chamadas).toBe(1);
  });

  it("desiste depois de 3 tentativas (não fica em laço)", async () => {
    let chamadas = 0;
    await expect(
      comNumeroUnico(async () => {
        chamadas++;
        throw corrida;
      })
    ).rejects.toBe(corrida);
    expect(chamadas).toBe(3);
  });

  it("as três portas de criação insistem: painel, catálogo e Nuvemshop", () => {
    expect(ler("src/app/api/orders/route.ts")).toContain("comNumeroUnico");
    expect(ler("src/app/api/catalog/order/route.ts")).toContain("comNumeroUnico");
    expect(ler("src/lib/nuvemshop.ts")).toContain("comNumeroUnico");
  });
});

// ---------------------------------------------------------------------------
describe("mudança de status e liquidação de Pix: transacionais e com trava", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");
  const settle = ler("src/lib/settle-order.ts");

  it("a transição de status trava no status LIDO (concorrente ganha 409)", () => {
    expect(rota).toContain("StatusMudou");
    expect(rota).toContain("status: order.status");
    expect(rota).toContain("O pedido acabou de ser alterado por outra pessoa");
  });

  it("o Pix confirmado liquida numa transação, com trava e folga de tempo", () => {
    expect(settle).toContain("$transaction");
    expect(settle).toContain("CorridaNoSettle");
    expect(settle).toContain("timeout: 30_000");
    // a baixa é condicionada — nunca decremento cego que ficava negativo
    expect(settle).toContain("reservarOQueTiver");
    expect(settle).not.toContain("stock: 0");
  });

  it("o valor PAGO é conferido: pagou menos que o pedido custa → NÃO liquida", () => {
    expect(settle).toContain("valorPago");
    expect(settle).toContain("NÃO foi marcado como pago");
    // o webhook do MP passa o valor que realmente entrou
    expect(ler("src/app/api/mercadopago/webhook/[token]/route.ts")).toContain(
      "payment?.transaction_amount"
    );
  });

  it("pedido editado invalida a cobrança Pix antiga (o QR velho não paga o pedido novo)", () => {
    expect(rota).toContain('provider: "MERCADO_PAGO"');
    expect(rota).toContain("a cobrança Pix/cartão anterior foi invalidada");
  });
});

// ---------------------------------------------------------------------------
describe("integrações espelham TODA mexida de estoque (uma venda, uma baixa)", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");

  it("edição de itens e exclusão avisam Nuvemshop/Jueri", () => {
    // edição: os deltas mudados; exclusão: o que foi devolvido
    expect(rota).toContain("mudadas.map(([variantId]) => variantId)");
    expect(rota).toContain("devolvidas.map((d) => d.variantId)");
  });
});

// ---------------------------------------------------------------------------
describe("webhook da Nuvemshop: falha NUNCA vira 200 mudo", () => {
  const webhook = ler("src/app/api/nuvemshop/webhook/route.ts");

  it("erro ao processar → 500 (a Nuvemshop reenvia) + registro no Saúde", () => {
    expect(webhook).toContain("status: 500");
    expect(webhook).toContain("logServerError");
  });
});
