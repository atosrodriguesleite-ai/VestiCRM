import { describe, it, expect } from "vitest";
import { escolherAlvos, norm, type VariacaoNs } from "../nuvemshop";
import { conferirVinculo, vinculosParaSoltar } from "../nuvemshop-conferencia";

// Guarda RN-072

/**
 * UMA PEÇA DAQUI ESPELHA UMA DE LÁ — e SKU repetido lá não casa por SKU.
 *
 * O caso que criou a regra (Regata Quadrada, 07/10/2026): na Nuvemshop os
 * tamanhos P, M, G e GG da Azul Marinho estavam todos com o SKU "RQD-MAR-P".
 * Aqui só a P tinha esse SKU, e as quatro de lá casavam com ela na mesma
 * rodada: a P daqui mostrava 50 (o estoque da M de lá) com 4 na arara.
 *
 * O caminho inteiro (o `upsertProduct` gravando no banco) é provado contra o
 * Postgres por `scripts/confere-sku-repetido-la.ts`.
 */

type Peca = {
  id: string;
  sku: string | null;
  nuvemshopId: string | null;
  nuvemshopProductId: string | null;
  tam?: string;
};

const NS = "np-rqd";
const peca = (id: string, sku: string | null, nuvemshopId: string | null = null, nsProd: string | null = nuvemshopId ? NS : null): Peca => ({
  id,
  sku,
  nuvemshopId,
  nuvemshopProductId: nsProd,
  tam: id,
});

/** Monta os mapas como a sincronização monta (com a trava de SKU repetido AQUI). */
function escolher(pecas: Peca[], la: { id: string; sku: string | null; tam: string }[]) {
  const vinculadas = new Map(pecas.filter((p) => p.nuvemshopId).map((p) => [p.nuvemshopId, p]));
  const vezes = new Map<string, number>();
  for (const p of pecas) if (norm(p.sku)) vezes.set(norm(p.sku), (vezes.get(norm(p.sku)) ?? 0) + 1);
  const porSku = new Map(
    pecas.filter((p) => norm(p.sku) && vezes.get(norm(p.sku)) === 1).map((p) => [norm(p.sku), p])
  );
  const porCorTam = new Map(pecas.map((p) => [`azul marinho|${norm(p.tam)}`, p]));
  const r = escolherAlvos({
    nsProductId: NS,
    variacoesDeLa: la.map((v) => ({ id: v.id, sku: v.sku, corTam: `azul marinho|${norm(v.tam)}` })),
    vinculadas,
    porSku,
    porCorTam,
  });
  return { ...r, resumo: Object.fromEntries([...r.alvos].map(([ns, p]) => [ns, p.id])) };
}

const repetidoLa = [
  { id: "ns-P", sku: "RQD-MAR-P", tam: "P" },
  { id: "ns-M", sku: "RQD-MAR-P", tam: "M" },
  { id: "ns-G", sku: "RQD-MAR-P", tam: "G" },
  { id: "ns-GG", sku: "RQD-MAR-P", tam: "GG" },
];
const corrigidoLa = [
  { id: "ns-P", sku: "RQD-MAR-P", tam: "P" },
  { id: "ns-M", sku: "RQD-MAR-M", tam: "M" },
  { id: "ns-G", sku: "RQD-MAR-G", tam: "G" },
  { id: "ns-GG", sku: "RQD-MAR-GG", tam: "GG" },
];
const cadaUmNoSeu = { "ns-P": "P", "ns-M": "M", "ns-G": "G", "ns-GG": "GG" };

describe("escolherAlvos (RN-072)", () => {
  it("SKU repetido lá: cada tamanho vai para o SEU, pela cor × tamanho", () => {
    const pecas = [peca("P", "RQD-MAR-P"), peca("M", "RQD-MAR-M"), peca("G", "RQD-MAR-G"), peca("GG", "RQD-MAR-GG")];
    const r = escolher(pecas, repetidoLa);
    expect(r.resumo).toEqual(cadaUmNoSeu);
    expect([...r.skuRepetidoLa]).toEqual([norm("RQD-MAR-P")]);
  });

  it("o estado torto de produção (P daqui ligada à M de lá) se desfaz sozinho, mesmo com o SKU ainda repetido", () => {
    // SKU repetido não confirma nada: o vínculo velho perde para a cor × tamanho
    const pecas = [peca("P", "RQD-MAR-P", "ns-M"), peca("M", "RQD-MAR-M"), peca("G", "RQD-MAR-G", "ns-G"), peca("GG", "RQD-MAR-GG", "ns-GG")];
    expect(escolher(pecas, repetidoLa).resumo).toEqual(cadaUmNoSeu);
  });

  it("corrigido o SKU lá, o vínculo velho também se desfaz — em qualquer ordem da API", () => {
    const pecas = [peca("P", "RQD-MAR-P", "ns-M"), peca("M", "RQD-MAR-M"), peca("G", "RQD-MAR-G", "ns-G"), peca("GG", "RQD-MAR-GG", "ns-GG")];
    expect(escolher(pecas, corrigidoLa).resumo).toEqual(cadaUmNoSeu);
    expect(escolher(pecas, [...corrigidoLa].reverse()).resumo).toEqual(cadaUmNoSeu);
    expect(escolher(pecas, [...repetidoLa].reverse()).resumo).toEqual(cadaUmNoSeu);
  });

  it("SKU repetido lá não segura vínculo velho nem quando a peça daqui não tem SKU", () => {
    const pecas = [peca("P", null), peca("M", null, "ns-P")];
    const r = escolher(pecas, [
      { id: "ns-P", sku: "R", tam: "P" },
      { id: "ns-M", sku: "R", tam: "M" },
    ]);
    expect(r.resumo).toEqual({ "ns-P": "P", "ns-M": "M" });
  });

  it("nenhuma peça daqui é alvo de duas variações de lá", () => {
    const pecas = [peca("P", "X", "ns-1")];
    const r = escolher(pecas, [
      { id: "ns-1", sku: "Y", tam: "Z" }, // vínculo que o SKU contradiz
      { id: "ns-2", sku: "X", tam: "Z" }, // SKU único que confirma a peça
    ]);
    expect(r.resumo).toEqual({ "ns-2": "P" });
    expect(r.ocupadas).toEqual(new Set(["P"]));
  });

  it("vínculo que o SKU contradiz continua valendo quando ninguém disputa a peça", () => {
    // a lojista trocou o SKU só lá: o estoque segue espelhado como sempre
    const r = escolher([peca("P", "ANTIGO", "ns-P")], [{ id: "ns-P", sku: "NOVO", tam: "Q" }]);
    expect(r.resumo).toEqual({ "ns-P": "P" });
  });

  it("SKU repetido lá sem cor × tamanho daqui: ninguém casa (vira pendência no laço)", () => {
    const r = escolher([peca("P", "RQD-MAR-P")], [
      { id: "ns-X", sku: "RQD-MAR-P", tam: "XG" },
      { id: "ns-Y", sku: "RQD-MAR-P", tam: "XXG" },
    ]);
    expect(r.alvos.size).toBe(0);
  });

  it("a cor × tamanho nunca toma a peça que já espelha OUTRO produto de lá", () => {
    // a lojista duplicou o produto lá: a cópia carrega o SKU repetido e não
    // pode arrastar a grade do original para si
    const pecas = [peca("P", "RQD-MAR-P", "ns-orig-P", "np-original")];
    const r = escolher(pecas, [
      { id: "ns-P", sku: "RQD-MAR-P", tam: "P" },
      { id: "ns-M", sku: "RQD-MAR-P", tam: "M" },
    ]);
    expect(r.alvos.size).toBe(0);
  });

  it("o SKU único não tira de outro produto de lá a peça quando a variação de lá já tem vínculo próprio", () => {
    const a1 = peca("A1", "VELHO", "ns-X");
    const b1 = peca("B1", "NOVO", "ns-Y", "np-B");
    const r = escolher([a1, b1], [{ id: "ns-X", sku: "NOVO", tam: "Q" }]);
    expect(r.resumo).toEqual({ "ns-X": "A1" });
  });

  it("SKU vazio não conta como repetido e a variação sem SKU segue pelo vínculo", () => {
    const r = escolher([peca("P", null, "ns-1")], [
      { id: "ns-1", sku: "", tam: "P" },
      { id: "ns-2", sku: null, tam: "M" },
    ]);
    expect(r.resumo).toEqual({ "ns-1": "P" });
    expect(r.skuRepetidoLa.size).toBe(0);
  });
});

describe("a conferência não chama de errado o vínculo que a cor × tamanho acertou (RN-072)", () => {
  const la: VariacaoNs[] = ["P", "M"].map((t) => ({
    varId: `ns-${t}`,
    prodId: NS,
    produto: "Regata Quadrada",
    cor: "Azul Marinho",
    tamanho: t,
    sku: "RQD-MAR-P",
    estoque: t === "P" ? 4 : 50,
  }));
  const aqui = [
    { id: "P", produto: "Regata Quadrada", cor: "Azul Marinho", tamanho: "P", sku: "RQD-MAR-P", estoque: 4, nsVarId: "ns-P" },
    { id: "M", produto: "Regata Quadrada", cor: "Azul Marinho", tamanho: "M", sku: "RQD-MAR-M", estoque: 50, nsVarId: "ns-M" },
  ];

  it("avisa o SKU repetido lá, sem 'vínculo cruzado' e sem nada para soltar", () => {
    const achados = conferirVinculo(aqui, la);
    expect(achados.map((a) => a.tipo)).toContain("SKU_DUPLICADO_LA");
    expect(achados.map((a) => a.tipo)).not.toContain("CARIMBO_CRUZADO");
    expect(vinculosParaSoltar(achados, true)).toEqual([]);
  });

  it("SKU repetido lá mas o par é de OUTRA cor × tamanho: segue sendo 'cruzado'", () => {
    // o G daqui ligado à M de lá é errado de verdade, repetido ou não
    const torto = [{ ...aqui[1], tamanho: "G", sku: "RQD-MAR-G" }];
    const achados = conferirVinculo(torto, la);
    expect(achados.map((a) => a.tipo)).toContain("CARIMBO_CRUZADO");
  });

  it("SKU repetido em produtos DIFERENTES lá: o vínculo para outro SKU segue sendo 'cruzado'", () => {
    // a sincronização casa pelo SKU quando ele é único DENTRO do produto
    const laEmDois = la.map((v) => (v.varId === "ns-M" ? { ...v, prodId: "np-copia" } : v));
    const achados = conferirVinculo(aqui, laEmDois);
    expect(achados.map((a) => a.tipo)).toContain("CARIMBO_CRUZADO");
  });

  it("com SKU único lá, o vínculo para outro SKU continua sendo 'cruzado'", () => {
    const laUnico = la.map((v) => (v.varId === "ns-M" ? { ...v, sku: "OUTRO" } : v));
    const achados = conferirVinculo(aqui, laUnico);
    expect(achados.map((a) => a.tipo)).toContain("CARIMBO_CRUZADO");
  });
});
