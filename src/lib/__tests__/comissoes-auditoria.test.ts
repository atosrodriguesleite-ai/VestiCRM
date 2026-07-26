import { describe, expect, it } from "vitest";

/**
 * Auditoria das métricas comerciais — as regras que espelham o cálculo das
 * telas de Comissões, Marketing e Dashboard. Erro aqui é dinheiro errado
 * no bolso de alguém ou decisão de investimento tomada em cima de conta
 * furada, então cada regra fica travada por teste.
 */

/* ---------------- comissão por vendedor ---------------- */

type Pedido = { sellerId: string | null; subtotal: number; total: number };
type Vendedor = { id: string; commissionRate: number; active: boolean };

/** Espelha o cálculo da tela de Comissões. */
function apurarComissoes(
  vendedores: Vendedor[],
  pedidos: Pedido[],
  base: "SUBTOTAL" | "TOTAL"
) {
  const porVendedor = new Map<string, { count: number; base: number }>();
  let semVendedor = { count: 0, base: 0 };
  for (const p of pedidos) {
    const val = base === "TOTAL" ? p.total : p.subtotal;
    if (!p.sellerId) {
      semVendedor = { count: semVendedor.count + 1, base: semVendedor.base + val };
      continue;
    }
    const cur = porVendedor.get(p.sellerId) ?? { count: 0, base: 0 };
    porVendedor.set(p.sellerId, { count: cur.count + 1, base: cur.base + val });
  }
  const linhas = vendedores
    .filter((v) => v.active || (porVendedor.get(v.id)?.count ?? 0) > 0)
    .map((v) => {
      const agg = porVendedor.get(v.id) ?? { count: 0, base: 0 };
      return {
        id: v.id,
        base: agg.base,
        orders: agg.count,
        commission: (agg.base * v.commissionRate) / 100,
        inactive: !v.active,
      };
    });
  return { linhas, semVendedor };
}

describe("apuração de comissões", () => {
  const pedidos: Pedido[] = [
    { sellerId: "ana", subtotal: 1000, total: 1100 }, // 100 de frete
    { sellerId: "ana", subtotal: 500, total: 500 },
    { sellerId: "bia", subtotal: 2000, total: 2000 }, // bia foi desligada
    { sellerId: null, subtotal: 300, total: 300 }, // Nuvemshop, sem vendedor
  ];
  const vendedores: Vendedor[] = [
    { id: "ana", commissionRate: 5, active: true },
    { id: "bia", commissionRate: 10, active: false },
    { id: "caio", commissionRate: 5, active: true }, // ativo, sem vendas
  ];

  it("comissão = base × taxa do vendedor", () => {
    const { linhas } = apurarComissoes(vendedores, pedidos, "SUBTOTAL");
    const ana = linhas.find((l) => l.id === "ana")!;
    expect(ana.base).toBe(1500);
    expect(ana.commission).toBe(75); // 5% de 1500
  });

  it("VENDEDOR DESLIGADO continua no relatório — a comissão dele é devida", () => {
    const { linhas } = apurarComissoes(vendedores, pedidos, "SUBTOTAL");
    const bia = linhas.find((l) => l.id === "bia");
    expect(bia).toBeDefined();
    expect(bia!.commission).toBe(200); // 10% de 2000
    expect(bia!.inactive).toBe(true);
  });

  it("nenhum real desaparece: soma das linhas + sem vendedor = total pago", () => {
    const { linhas, semVendedor } = apurarComissoes(vendedores, pedidos, "SUBTOTAL");
    const somado = linhas.reduce((a, l) => a + l.base, 0) + semVendedor.base;
    const totalPago = pedidos.reduce((a, p) => a + p.subtotal, 0);
    expect(somado).toBe(totalPago); // 1500 + 2000 + 300 = 3800
  });

  it("desligado SEM vendas no período não polui a lista", () => {
    const { linhas } = apurarComissoes(vendedores, [pedidos[0]], "SUBTOTAL");
    expect(linhas.map((l) => l.id)).not.toContain("bia");
  });

  it("base TOTAL inclui o frete; base SUBTOTAL não", () => {
    const sub = apurarComissoes(vendedores, [pedidos[0]], "SUBTOTAL").linhas[0];
    const tot = apurarComissoes(vendedores, [pedidos[0]], "TOTAL").linhas[0];
    expect(sub.base).toBe(1000);
    expect(tot.base).toBe(1100);
  });

  it("pedido sem vendedor (integração) fica separado, não some", () => {
    const { semVendedor } = apurarComissoes(vendedores, pedidos, "SUBTOTAL");
    expect(semVendedor).toEqual({ count: 1, base: 300 });
  });
});

/* ---------------- conversão de campanha (coorte) ---------------- */

type Lead = { id: string; campaignId: string | null };

/** Espelha a conversão por coorte do Marketing. */
function conversaoCampanha(
  leadsDoPeriodo: Lead[],
  compradores: Set<string>,
  campaignId: string
): number | null {
  const daCampanha = leadsDoPeriodo.filter((l) => l.campaignId === campaignId);
  if (daCampanha.length === 0) return null;
  const converteram = daCampanha.filter((l) => compradores.has(l.id)).length;
  return Math.round((converteram / daCampanha.length) * 100);
}

describe("conversão por campanha", () => {
  const leads: Lead[] = [
    { id: "l1", campaignId: "c1" },
    { id: "l2", campaignId: "c1" },
    { id: "l3", campaignId: "c1" },
    { id: "l4", campaignId: "c1" },
    { id: "l5", campaignId: "c2" },
  ];

  it("mede os leads DA COORTE que compraram", () => {
    const compradores = new Set(["l1", "l2"]);
    expect(conversaoCampanha(leads, compradores, "c1")).toBe(50); // 2 de 4
  });

  it("NUNCA passa de 100% — nem com comprador antigo comprando agora", () => {
    // "l99" é lead de outro mês que comprou neste; não conta na coorte
    const compradores = new Set(["l1", "l2", "l3", "l4", "l99", "l98", "l97"]);
    expect(conversaoCampanha(leads, compradores, "c1")).toBe(100);
  });

  it("campanha sem lead no período não inventa conversão", () => {
    expect(conversaoCampanha(leads, new Set(), "c3")).toBeNull();
  });

  it("nenhum lead comprou = 0%, e isso é informação (não é vazio)", () => {
    expect(conversaoCampanha(leads, new Set(), "c1")).toBe(0);
  });
});

/* ---------------- variação vs período anterior ---------------- */

const pctDelta = (cur: number, prev: number) =>
  prev > 0 ? ((cur - prev) / prev) * 100 : null;

describe("variação percentual entre períodos", () => {
  it("calcula a variação sobre a base anterior", () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(80, 100)).toBe(-20);
  });

  it("sem base anterior não inventa número (nem 100%, nem 0%)", () => {
    expect(pctDelta(500, 0)).toBeNull();
  });

  it("mesma regra vale pra queda a zero", () => {
    expect(pctDelta(0, 100)).toBe(-100);
  });
});
