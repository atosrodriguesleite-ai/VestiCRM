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
    // fechou a transação no meio do ajuste de estoque peça a peça.
    // 4 transações: mudança de status, edição de itens, edição de valores e
    // exclusão — todas com a mesma folga.
    expect(rota.split("{ timeout: 30_000, maxWait: 10_000 }").length).toBe(5);
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
  it("a regra do retrato ajusta SKU/foto pelo que a variação diz", () => {
    const lib = ler("src/lib/religar-itens.ts");
    // regra PURA (serve à tela e à gravação — ver page.tsx do pedido)
    expect(lib).toContain("export function retratoCerto");
    expect(lib).toContain("export async function gravarRetratoDosItens");
    expect(lib).toContain("v.sku ?? v.product.sku");
    // nunca mexe em dinheiro nem estoque — só o retrato
    expect(lib).not.toContain("unitPrice");
    expect(lib).not.toContain("stock");
  });

  it("a ficha do pedido conserta de carona — na TELA já, no banco depois", () => {
    // Desde 20/08/2026 o conserto saiu da frente da tela (eram 6 idas ao
    // banco em fila antes de desenhar qualquer coisa). O que NÃO pode mudar:
    // a primeira abertura já mostra o retrato certo, e a correção é gravada.
    const page = ler("src/app/(app)/pedidos/[id]/page.tsx");
    // a tela aplica a regra pura no que veio do banco...
    expect(page).toContain("retratoCerto(item)");
    // ...e a gravação acontece depois de a página ser entregue
    expect(page).toContain("gravarRetratoDosItens(itensParaGravar, id, user.companyId)");
    expect(page).toMatch(/after\(async \(\) => \{/);
    // a foto e o SKU exibidos são os corrigidos (não os do banco)
    expect(page).toContain("item.sku = certo.sku");
    expect(page).toContain("item.imageUrl = certo.imageUrl");
  });

  it("a gravação do retrato segue presa à loja (RN-013) e ao pedido", () => {
    const lib = ler("src/lib/religar-itens.ts");
    // updateMany com escopo: dado já carregado não afrouxa o multi-tenant
    expect(lib).toContain("where: { id: c.id, orderId, order: { companyId } }");
  });
});
