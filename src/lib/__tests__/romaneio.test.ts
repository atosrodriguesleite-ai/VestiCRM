import { describe, it, expect } from "vitest";
import { ordenarParaSeparacao, pesoTamanho } from "../romaneio";

/**
 * ORDEM DE SEPARAÇÃO DO ROMANEIO (12/08/2026): categoria → produto → cor →
 * tamanho de gente → quantidade decrescente. Quem separa anda UMA vez pelo
 * estoque.
 */

describe("tamanho ordena como roupa, não como alfabeto", () => {
  it("PP < P < M < G < GG (no alfabeto o G vinha antes do M)", () => {
    const ordem = ["GG", "M", "PP", "G", "P"].sort((a, b) => pesoTamanho(a) - pesoTamanho(b));
    expect(ordem).toEqual(["PP", "P", "M", "G", "GG"]);
  });
  it("numeração cresce (36 < 38 < 40) e vem depois das letras", () => {
    expect(pesoTamanho("38")).toBeLessThan(pesoTamanho("40"));
    expect(pesoTamanho("GG")).toBeLessThan(pesoTamanho("36"));
  });
  it("Único e desconhecidos vão para o fim, sem quebrar", () => {
    expect(pesoTamanho("Único")).toBeGreaterThan(pesoTamanho("44"));
    expect(pesoTamanho(null)).toBeGreaterThan(pesoTamanho("Único"));
  });
});

describe("o pedido bagunçado sai na ordem da prateleira", () => {
  const categoria = (pid: string | null) =>
    pid === "regata" ? "Regatas" : pid === "vestido" ? "Vestidos" : "";

  it("categoria → produto → cor → tamanho → quantidade maior primeiro", () => {
    const bagunca = [
      { productId: "vestido", name: "Vestido Longo", color: "Azul", size: "M", quantity: 1 },
      { productId: "regata", name: "Regata Alça", color: "Preto", size: "G", quantity: 2 },
      { productId: "regata", name: "Regata Alça", color: "Branco", size: "M", quantity: 5 },
      { productId: "regata", name: "Regata Alça", color: "Branco", size: "P", quantity: 1 },
      { productId: "regata", name: "Regata Alça", color: "Branco", size: "M", quantity: 2 },
      { productId: null, name: "Linha avulsa", color: null, size: null, quantity: 1 },
      { productId: "regata", name: "Regata Gola Alta", color: "Branco", size: "P", quantity: 3 },
    ];
    const ordenado = ordenarParaSeparacao(bagunca, categoria);
    expect(
      ordenado.map((i) => `${i.name}|${i.color ?? "-"}|${i.size ?? "-"}|${i.quantity}`)
    ).toEqual([
      // Regatas primeiro (alfabético), dentro: produto, cor, tamanho, qtde desc
      "Regata Alça|Branco|P|1",
      "Regata Alça|Branco|M|5",
      "Regata Alça|Branco|M|2",
      "Regata Alça|Preto|G|2",
      "Regata Gola Alta|Branco|P|3",
      // depois Vestidos
      "Vestido Longo|Azul|M|1",
      // linha sem produto (sem categoria) por último
      "Linha avulsa|-|-|1",
    ]);
  });

  it("não altera a lista original (o total do pedido não pode mudar)", () => {
    const itens = [
      { productId: "regata", name: "B", color: "X", size: "M", quantity: 1 },
      { productId: "regata", name: "A", color: "X", size: "M", quantity: 1 },
    ];
    const copia = [...itens];
    ordenarParaSeparacao(itens, categoria);
    expect(itens).toEqual(copia);
  });
});

describe("o PDF usa a ordem de separação com cabecinho por categoria", () => {
  it("a rota ordena e agrupa", async () => {
    const { readFileSync } = await import("node:fs");
    const rota = readFileSync("src/app/api/orders/[id]/pdf/route.ts", "utf8");
    expect(rota).toContain("ordenarParaSeparacao(order.items, categoriaDe)");
    expect(rota).toContain("for (const item of itensOrdenados)");
    expect(rota).toContain('cat || "Outros itens"');
  });
});
