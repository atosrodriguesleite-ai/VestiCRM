import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { casarItens, type CandidataAtual, type ItemQuebrado } from "../religar-itens";

/**
 * RELIGAR ITENS DO PEDIDO (incidente Toque Leve, 30/07/2026).
 *
 * A lojista desfez a importação da Nuvemshop e reimportou. Os produtos
 * voltaram como peças NOVAS (id novo) e o item do pedido ficou apontando para
 * o vazio. O pedido não perdeu nada — nome, SKU, cor, tamanho e preço são
 * cópia gravada no item —, mas a tela lia o estoque pelo ponteiro e mostrava
 * "Regata Quadrada · Branco · M · estoque 0 (insuficiente)" numa peça com
 * estoque de sobra na Nuvemshop e no catálogo.
 *
 * Aviso falso de estoque zero é grave: a vendedora desiste da venda.
 */

const item = (p: Partial<ItemQuebrado> & { id: string; name: string }): ItemQuebrado => ({
  sku: null,
  color: null,
  size: null,
  ...p,
});

const atual = (
  p: Partial<CandidataAtual> & { variantId: string; produto: string }
): CandidataAtual => ({
  productId: `prod-${p.produto}`,
  sku: null,
  color: "Branco",
  size: "M",
  ...p,
});

describe("religar pelo SKU (o caminho normal)", () => {
  it("acha a peça nova pelo SKU do item", () => {
    const pares = casarItens(
      [item({ id: "i1", name: "Regata Quadrada", sku: "RQD-BRA-M", color: "Branco", size: "M" })],
      [atual({ variantId: "v-novo", produto: "Regata Quadrada", sku: "RQD-BRA-M" })]
    );
    expect(pares).toEqual([
      { itemId: "i1", variantId: "v-novo", productId: "prod-Regata Quadrada" },
    ]);
  });

  it("acento e maiúscula no SKU não atrapalham", () => {
    const pares = casarItens(
      [item({ id: "i1", name: "X", sku: "  rqd-bra-m " })],
      [atual({ variantId: "v1", produto: "X", sku: "RQD-BRA-M" })]
    );
    expect(pares[0].variantId).toBe("v1");
  });

  it("SKU REPETIDO não religa (foi a origem da bagunça — não chuta)", () => {
    const pares = casarItens(
      [item({ id: "i1", name: "Regata", sku: "DUP" })],
      [
        atual({ variantId: "v1", produto: "Regata", sku: "DUP", size: "G" }),
        atual({ variantId: "v2", produto: "Regata", sku: "DUP", size: "GG" }),
      ]
    );
    expect(pares).toEqual([]);
  });
});

describe("religar por nome + cor + tamanho (item sem SKU)", () => {
  it("acha quando o item não tem SKU", () => {
    const pares = casarItens(
      [item({ id: "i1", name: "Regata Quadrada", color: "Vinho", size: "M" })],
      [
        atual({ variantId: "v1", produto: "Regata Quadrada", color: "Vinho", size: "M" }),
        atual({ variantId: "v2", produto: "Regata Quadrada", color: "Branco", size: "M" }),
      ]
    );
    expect(pares[0].variantId).toBe("v1");
  });

  it("jeito de escrever não separa (acento e caixa)", () => {
    const pares = casarItens(
      [item({ id: "i1", name: "REGATA ALÇA", color: "cafe", size: "m" })],
      [atual({ variantId: "v1", produto: "Regata Alça", color: "Café", size: "M" })]
    );
    expect(pares[0].variantId).toBe("v1");
  });

  it("cor diferente NÃO casa (não pode religar na peça errada)", () => {
    const pares = casarItens(
      [item({ id: "i1", name: "Regata", color: "Vinho", size: "M" })],
      [atual({ variantId: "v1", produto: "Regata", color: "Branco", size: "M" })]
    );
    expect(pares).toEqual([]);
  });
});

describe("o que não dá pra saber fica de fora", () => {
  it("peça que não existe mais não religa em nada", () => {
    expect(
      casarItens([item({ id: "i1", name: "Sumiu", sku: "XXX" })], [])
    ).toEqual([]);
  });

  it("religa o que dá e deixa o resto quieto", () => {
    const pares = casarItens(
      [
        item({ id: "ok", name: "A", sku: "S1" }),
        item({ id: "perdido", name: "B", sku: "S9" }),
      ],
      [atual({ variantId: "v1", produto: "A", sku: "S1" })]
    );
    expect(pares).toHaveLength(1);
    expect(pares[0].itemId).toBe("ok");
  });

  it("nenhum item quebrado → nenhum par (não faz nada à toa)", () => {
    expect(casarItens([], [atual({ variantId: "v1", produto: "A" })])).toEqual([]);
  });
});

describe("as portas estão ligadas", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("a religação roda ao abrir o pedido", () => {
    const page = ler("src/app/(app)/pedidos/[id]/page.tsx");
    expect(page).toContain("religarItensDoPedido(id, user.companyId)");
  });

  it("só mexe em pedido da própria loja (multi-tenant)", () => {
    const lib = ler("src/lib/religar-itens.ts");
    expect(lib).toContain("order: { companyId }");
    expect(lib).toContain("product: { companyId }");
  });

  it("nunca toca em estoque — só no ponteiro", () => {
    const lib = ler("src/lib/religar-itens.ts");
    expect(lib).toContain("data: { variantId: p.variantId, productId: p.productId }");
    expect(lib).not.toContain("stock:");
    expect(lib).not.toContain("inventoryMovement");
  });

  it("sem vínculo a tela fala a verdade (não inventa estoque zero)", () => {
    const tela = ler("src/app/(app)/pedidos/[id]/items-editor.tsx");
    expect(tela).toContain("peça não está mais no catálogo");
    expect(tela).toContain("const semVinculo = !l.variantId");
    // "insuficiente" só quando existe vínculo de verdade
    expect(tela).toContain("const falta = !semVinculo && l.quantity > l.stock");
  });

  it("cada linha é ela mesma: nada mais é mexido PELO VÍNCULO", () => {
    // duas peças sem vínculo tinham o mesmo "" e viravam a MESMA linha:
    // subir a quantidade de uma subia a da outra, apagar uma apagava as duas
    const tela = ler("src/app/(app)/pedidos/[id]/items-editor.tsx");
    expect(tela).not.toContain("x.variantId === l.variantId");
    expect(tela).not.toContain("x.variantId !== l.variantId");
    expect(tela).toContain("prev.map((x, xi) => (xi === i ?");
    expect(tela).toContain("prev.filter((_, xi) => xi !== i)");
  });
});
