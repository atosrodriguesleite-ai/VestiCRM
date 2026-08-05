import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ITEM DO PEDIDO COM SKU E FOTO DA PEÇA ESCOLHIDA — incidente Entre Linhas
 * (04/08/2026): item "Azul Serenity" aparecia com o SKU e a foto da peça
 * PRETA. Causa: o item gravava o SKU DO PRODUTO (que em produto importado da
 * Nuvemshop é o da 1ª variação) e a foto era sempre a capa geral.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("pedido do catálogo público grava a peça CERTA", () => {
  const rota = ler("src/app/api/catalog/order/route.ts");

  it("SKU da VARIAÇÃO escolhida (produto é só o plano B)", () => {
    expect(rota).toContain("sku: variant.sku ?? product.sku");
  });

  it("foto DA COR escolhida (capa geral é só o plano B)", () => {
    expect(rota).toContain("corIgual(im.color, variant.color)");
  });

  it("as fotos vêm só com id+cor (o base64 fica no banco)", () => {
    expect(rota).toContain("select: { id: true, color: true }");
  });
});

describe("pedido montado no sistema grava a peça CERTA", () => {
  const rota = ler("src/app/api/orders/route.ts");

  it("SKU da variação e foto da cor", () => {
    expect(rota).toContain("sku: v.sku ?? v.product.sku");
    expect(rota).toContain("corIgual(im.color, v.color)");
  });
});

describe("EDITAR itens também grava a peça certa (o vício não volta pela edição)", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");

  it("SKU da variação e foto da cor na edição", () => {
    expect(rota).toContain("sku: v.sku ?? v.product.sku");
    expect(rota).toContain("corIgual(im.color, v.color)");
  });

  it("erro inesperado ao salvar NUNCA é mudo: explica e registra no Saúde", () => {
    expect(rota).toContain("Pedido: falha inesperada ao salvar edição");
    expect(rota).toContain("painel Saúde");
  });

  it("as transações do pedido têm folga de tempo (o 5s padrão fechava no meio)", () => {
    // causa real do incidente: 'Transaction not found' — o banco na nuvem
    // fechou a transação no meio do ajuste de estoque peça a peça
    expect(rota.split("{ timeout: 30_000, maxWait: 10_000 }").length).toBe(4);
  });
});

describe("romaneio: a miniatura é a foto da COR do item", () => {
  const rota = ler("src/app/api/orders/[id]/pdf/route.ts");

  it("escolhe por item (cor primeiro) e embute cada imagem uma vez", () => {
    expect(rota).toContain("corIgual(f.color, item.color)");
    expect(rota).toContain("fotoByItem.get(item.id)");
  });
});

describe("pedidos ANTIGOS se consertam sozinhos ao abrir a ficha", () => {
  it("corrigirRetratoDosItens ajusta SKU/foto pelo que a variação diz", () => {
    const lib = ler("src/lib/religar-itens.ts");
    expect(lib).toContain("export async function corrigirRetratoDosItens");
    expect(lib).toContain("v.sku ?? v.product.sku");
    // nunca mexe em dinheiro nem estoque — só o retrato
    expect(lib).not.toContain("unitPrice");
    expect(lib).not.toContain("stock");
  });

  it("a ficha do pedido chama o conserto de carona", () => {
    expect(ler("src/app/(app)/pedidos/[id]/page.tsx")).toContain(
      "corrigirRetratoDosItens(id, user.companyId)"
    );
  });
});
