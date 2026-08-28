import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { montarRanking, chaveDoNome, previousPeriod, valorVendidoDoItem } from "../tracking/insights";

/**
 * Ranking "Produtos — atenção × venda" da tela Inteligência.
 *
 * Dois defeitos reais (print do dono, 22/08/2026):
 *  1. "Regata Alça" aparecia DUAS vezes — nomes iguais aos olhos, diferentes
 *     no invisível (espaço no fim, acento composto de outro jeito, caixa);
 *  2. Conv. 100% em quase tudo — comparava PEÇAS na sacola com ABERTURAS da
 *     ficha, e no atacado uma adição é uma grade de 10+ peças.
 */

const produto = { id: "p1", name: "Regata Alça", category: "Regatas" };

describe("uma linha por produto (nada de xará invisível)", () => {
  it("espaço sobrando no nome congelado NÃO cria linha nova", () => {
    const linhas = montarRanking(
      [
        { type: "product_view", productId: "p1", productName: "Regata Alça" },
        // produto foi apagado do cadastro: sobra o nome da época, com espaço
        { type: "product_view", productId: "morto", productName: "Regata Alça " },
      ],
      [],
      [produto],
      "productName"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].views).toBe(2);
    expect(linhas[0].key).toBe("Regata Alça");
  });

  it("acento gravado de outro jeito (ç decomposto) também junta", () => {
    const decomposto = "Regata Alça"; // "ç" como c + cedilha combinante
    expect(chaveDoNome(decomposto)).toBe("Regata Alça");
    const linhas = montarRanking(
      [
        { type: "product_view", productId: null, productName: "Regata Alça" },
        { type: "product_view", productId: null, productName: decomposto },
      ],
      [],
      [],
      "productName"
    );
    expect(linhas).toHaveLength(1);
  });

  it("caixa diferente junta, e o nome exibido é o do cadastro", () => {
    const linhas = montarRanking(
      [{ type: "product_view", productId: "p1", productName: "Regata Alça" }],
      [{ productId: null, name: "REGATA ALÇA", quantity: 5, total: 160 }],
      [produto],
      "productName"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].key).toBe("Regata Alça");
    expect(linhas[0].sold).toBe(5);
  });

  it("nome congelado com espaço ainda ACHA o cadastro (venda não some da linha)", () => {
    const linhas = montarRanking(
      [{ type: "product_view", productId: "p1", productName: "Regata Alça" }],
      [{ productId: null, name: " Regata Alça ", quantity: 3, total: 96 }],
      [produto],
      "productName"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].sold).toBe(3);
  });

  it("produtos DIFERENTES de verdade continuam separados", () => {
    const linhas = montarRanking(
      [
        { type: "product_view", productId: "p1", productName: "Regata Alça" },
        { type: "product_view", productId: "p2", productName: "Regata de Alça" },
      ],
      [],
      [produto, { id: "p2", name: "Regata de Alça", category: "Regatas" }],
      "productName"
    );
    expect(linhas).toHaveLength(2);
  });
});

describe("conversão compara evento com evento (grade de atacado não estoura)", () => {
  it("3 aberturas, 1 adição de grade de 10 peças → 33%, não 100%", () => {
    const abertura = { type: "product_view", productId: "p1", productName: "Regata Alça" };
    const linhas = montarRanking(
      [
        abertura, abertura, abertura,
        { type: "cart_add", productId: "p1", productName: "Regata Alça", qty: 10 },
      ],
      [],
      [produto],
      "productName"
    );
    expect(linhas[0].adds).toBe(10); // +Sacola segue em PEÇAS (útil no atacado)
    expect(linhas[0].conversion).toBe(33.33);
  });

  it("teto de 100% continua (adição com a ficha aberta antes do recorte)", () => {
    const linhas = montarRanking(
      [{ type: "cart_add", productId: "p1", productName: "Regata Alça", qty: 12 }],
      [],
      [produto],
      "productName"
    );
    expect(linhas[0].conversion).toBe(100);
  });
});

describe("faturamento das linhas bate com o cartão (rateio do desconto global)", () => {
  // ADR-013: desconto/acréscimo são do PEDIDO; o item guarda preço × qtd.
  // Somar item.total fazia Produtos/Categorias mostrarem MAIS que a Visão
  // Geral (que soma netTotal, RN-002) — auditoria 24/08/2026.
  it("pedido de 1.000 com 10% de desconto: item de 100 vale 90", () => {
    expect(valorVendidoDoItem(100, 1000, 900)).toBe(90);
  });

  it("acréscimo também entra na fatia do item", () => {
    // subtotal 1.000 + acréscimo 100 → netTotal 1.100
    expect(valorVendidoDoItem(100, 1000, 1100)).toBeCloseTo(110, 10);
  });

  it("a soma das fatias devolve exatamente o netTotal do pedido", () => {
    const itens = [250, 330.5, 419.5]; // subtotal 1.000
    const soma = itens.reduce((a, t) => a + valorVendidoDoItem(t, 1000, 876.54), 0);
    expect(soma).toBeCloseTo(876.54, 8);
  });

  it("pedido sem subtotal (dado velho) não divide por zero: vale o total do item", () => {
    expect(valorVendidoDoItem(50, 0, 0)).toBe(50);
  });

  it("a consulta da Inteligência aplica o rateio de verdade", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src/lib/tracking/insights.ts"),
      "utf8"
    );
    expect(fonte).toContain("valorVendidoDoItem(item.total, item.order.subtotal, item.order.netTotal)");
  });
});

describe("Dashboard funde o ranking pela chave normalizada (incidente 27/08/2026)", () => {
  // Duas linhas "Regata Alça" (175 e 20 un.) no cartão: nomes que renderizam
  // IGUAIS mas diferem em bytes (ç decomposto, espaço no fim) não se fundiam,
  // porque a fusão usava a string crua como chave do Map.
  const page = readFileSync(
    join(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
    "utf8"
  );

  it("a chave de fusão passa por chaveDoNome (não a string crua)", () => {
    expect(page).toContain("chaveDoNome(rotulo).toLowerCase()");
    expect(page).toContain("`nome:${chaveDoNome(t.name)}`");
  });

  it("chaveDoNome junta as variantes do incidente numa linha só", () => {
    const nfc = "Regata Alça";
    const nfd = "Regata Alça".normalize("NFD");
    const comEspaco = "Regata Alça ";
    const comNbsp = "Regata Alça";
    const chaves = new Set(
      [nfc, nfd, comEspaco, comNbsp].map((s) => chaveDoNome(s).toLowerCase())
    );
    expect(chaves.size).toBe(1);
  });
});

describe("auditoria 27/08/2026 — categoria renomeada e views de cor", () => {
  const camisa = { id: "p9", name: "Camisa Festa", category: "Festa" };

  it("categoria renomeada: a SACOLA também segue o cadastro atual (não a da época)", () => {
    const linhas = montarRanking(
      [
        { type: "product_view", productId: "p9", productName: "Camisa Festa", category: "Vestidos" },
        // adicionada quando a categoria ainda se chamava "Vestidos"
        { type: "cart_add", productId: "p9", productName: "Camisa Festa", category: "Vestidos", qty: 3 },
      ],
      [],
      [camisa],
      "category"
    );
    // uma linha só ("Festa"), com view E adds juntos — antes o cart_add
    // ficava numa linha fantasma "Vestidos"
    expect(linhas).toHaveLength(1);
    expect(linhas[0].key).toBe("Festa");
    expect(linhas[0].views).toBe(1);
    expect(linhas[0].adds).toBe(3);
  });

  it("abrir a ficha NÃO conta view de cor em dobro (product_view + color_select do mesmo gesto)", () => {
    const linhas = montarRanking(
      [
        { type: "product_view", productId: "p9", productName: "Camisa Festa", color: "Rosa" },
        { type: "color_select", productId: "p9", productName: "Camisa Festa", color: "Rosa" },
      ],
      [],
      [camisa],
      "color"
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].views).toBe(1); // era 2 — a conversão por cor saía pela metade
  });
});

describe("previousPeriod — comparativo sem venda contada em dobro", () => {
  it("período de dias inteiros: o anterior termina 1ms ANTES do atual (a venda da borda não conta 2×)", () => {
    const p = {
      from: new Date("2026-08-01T03:00:00.000Z"),
      to: new Date("2026-08-21T02:59:59.999Z"),
    };
    const prev = previousPeriod(p);
    expect(prev.to.getTime()).toBe(p.from.getTime() - 1);
    expect(prev.to.getTime()).toBeLessThan(p.from.getTime());
  });

  it('"Hoje" compara com o MESMO trecho de ontem (não com a noite inteira)', () => {
    const DIA = 24 * 60 * 60 * 1000;
    const p = {
      from: new Date("2026-08-27T03:00:00.000Z"), // 00:00 SP
      to: new Date("2026-08-27T10:10:00.000Z"), // 07:10 SP
    };
    const prev = previousPeriod(p);
    expect(prev.from.getTime()).toBe(p.from.getTime() - DIA);
    expect(prev.to.getTime()).toBe(p.to.getTime() - DIA);
  });
});
