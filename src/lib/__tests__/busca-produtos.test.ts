import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { casaProduto, filtrarProdutos } from "../busca";

/**
 * BUSCA DE PRODUTO NOS PEDIDOS.
 *
 * Caso real (20/08/2026): a loja criou um produto novo ("Regata de Alça") e
 * ele NÃO aparecia ao pesquisar "ALÇA" na tela de editar itens do pedido.
 * Dois buracos juntos:
 *
 *  1. A tela CORTAVA a lista em 8 resultados — com dezenas de "Regata Alça"
 *     na frente (ordem alfabética), o produto novo nunca entrava nos 8,
 *     mesmo com a lista tendo barra de rolagem.
 *  2. O "contains" do banco não ignora acento: "alca" não achava "Alça".
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("casaProduto — nome ou SKU, sem acento e sem maiúscula", () => {
  const regata = { name: "Regata de Alça", sku: "RAL-Mar-P" };

  it("acha pelo nome com e sem acento", () => {
    expect(casaProduto(regata, "ALÇA")).toBe(true);
    expect(casaProduto(regata, "alca")).toBe(true);
    expect(casaProduto(regata, "regata de")).toBe(true);
  });

  it("acha pelo SKU ignorando maiúscula", () => {
    expect(casaProduto(regata, "ral-mar")).toBe(true);
  });

  it("não acha o que não tem", () => {
    expect(casaProduto(regata, "cropped")).toBe(false);
  });

  it("termo vazio casa tudo (a lista sem filtro)", () => {
    expect(casaProduto(regata, "  ")).toBe(true);
  });
});

describe("filtrarProdutos — relevância e teto", () => {
  const p = (name: string, sku = "X") => ({ name, sku });

  it("quem começa com o termo vem primeiro, o resto em ordem alfabética", () => {
    const lista = [p("Regata Alça"), p("Alça Fina"), p("Body de Alça")];
    expect(filtrarProdutos(lista, "alça").map((x) => x.name)).toEqual([
      "Alça Fina",
      "Body de Alça",
      "Regata Alça",
    ]);
  });

  it("respeita o teto (a query de ids não pode crescer sem limite)", () => {
    const lista = Array.from({ length: 100 }, (_, i) => p(`Blusa ${String(i).padStart(3, "0")}`));
    expect(filtrarProdutos(lista, "blusa", 60)).toHaveLength(60);
  });

  it("casa sem acento também no filtro", () => {
    expect(filtrarProdutos([p("Regata de Alça")], "alca")).toHaveLength(1);
  });
});

describe("as portas usam a busca tolerante e mostram a lista inteira", () => {
  it("a rota /api/products filtra com filtrarProdutos (não com o contains do banco)", () => {
    const rota = ler("src/app/api/products/route.ts");
    expect(rota).toContain("filtrarProdutos");
    expect(rota).not.toContain("contains: q");
    // termo só de espaços não pode virar varredura da loja inteira
    expect(rota).toContain('sp.get("q")?.trim() || undefined');
  });

  it("editar itens e novo pedido não cortam mais a lista em 8", () => {
    for (const tela of [
      "src/app/(app)/pedidos/[id]/items-editor.tsx",
      "src/app/(app)/pedidos/new-order.tsx",
    ]) {
      expect(ler(tela)).not.toContain("products.slice(0, 8)");
    }
  });
});
