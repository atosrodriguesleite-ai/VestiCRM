import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { carrinhosAbandonados } from "../tracking/insights";
import { lembrarOrigem } from "../catalogo/origem";
import { ehRobo } from "../robo";

/**
 * MARKETING HONESTO — Lote 1 da auditoria de 06/08/2026.
 *
 * A régua: nenhum número pode mentir e as telas têm que bater. Estes testes
 * guardam as quatro correções graves + as duas de atribuição:
 *  • faturamento por canal/campanha = pedido PAGO ligado à sessão (nunca o
 *    valor da sacola vindo do navegador);
 *  • conversão marcada no SERVIDOR, uma vez por pedido criado;
 *  • robô não conta clique na bio (mesma régua da visita);
 *  • carrinhos abandonados: KPI e lista com a MESMA conta;
 *  • a origem (?ref da vendedora) sobrevive 7 dias no aparelho.
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ---------------------------------------------------------------------------
describe("carrinhos abandonados: 1 pessoa = 1 carrinho (régua única)", () => {
  const sessao = (over: Partial<Parameters<typeof carrinhosAbandonados>[0][number]>) => ({
    visitorId: "v1",
    converted: false,
    cartAdds: 1,
    cartValue: 100,
    startedAt: new Date("2026-08-01T12:00:00Z"),
    ...over,
  });

  it("a mesma cliente em duas visitas conta UMA vez — a sacola mais recente", () => {
    const out = carrinhosAbandonados([
      sessao({ cartValue: 500, startedAt: new Date("2026-08-01T10:00:00Z") }),
      sessao({ cartValue: 550, startedAt: new Date("2026-08-02T10:00:00Z") }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].cartValue).toBe(550);
  });

  it("sacola esvaziada (valor 0) e sessão convertida ficam de fora", () => {
    const out = carrinhosAbandonados([
      sessao({ visitorId: "a", cartValue: 0 }),
      sessao({ visitorId: "b", converted: true }),
      sessao({ visitorId: "c", cartValue: 80 }),
    ]);
    expect(out.map((s) => s.visitorId)).toEqual(["c"]);
  });
});

// ---------------------------------------------------------------------------
describe("origem da visita sobrevive à sessão (comissão do link)", () => {
  function storageFake() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }
  const DIA = 24 * 60 * 60 * 1000;

  it("o link da vendedora é guardado e vale na visita seguinte SEM parâmetro", () => {
    const st = storageFake();
    lembrarOrigem(st, "loja", { ref: "lara", c: null }, 0);
    const depois = lembrarOrigem(st, "loja", { ref: null, c: null }, 2 * DIA);
    expect(depois.ref).toBe("lara");
  });

  it("link NOVO sobrescreve o antigo (quem mandou o link atende)", () => {
    const st = storageFake();
    lembrarOrigem(st, "loja", { ref: "lara" }, 0);
    lembrarOrigem(st, "loja", { ref: "julia" }, DIA);
    const depois = lembrarOrigem(st, "loja", { ref: null }, 2 * DIA);
    expect(depois.ref).toBe("julia");
  });

  it("depois de 7 dias a origem vence — visita volta a contar como veio", () => {
    const st = storageFake();
    lembrarOrigem(st, "loja", { ref: "lara" }, 0);
    const depois = lembrarOrigem(st, "loja", { ref: null }, 8 * DIA);
    expect(depois.ref).toBe(null);
  });

  it("storage quebrado nunca derruba o catálogo (usa a URL)", () => {
    const quebrado = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
      removeItem: () => {},
    };
    expect(lembrarOrigem(quebrado, "loja", { ref: "lara" }, 0).ref).toBe("lara");
  });
});

// ---------------------------------------------------------------------------
describe("robô não conta métrica (visita E clique com a mesma régua)", () => {
  it("robôs e prévias de link são reconhecidos; navegador de verdade não", () => {
    expect(ehRobo("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(ehRobo("WhatsApp/2.23.20")).toBe(true);
    expect(ehRobo("")).toBe(true);
    expect(
      ehRobo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1")
    ).toBe(false);
  });

  it("o clique da bio usa o MESMO filtro da visita", () => {
    expect(ler("src/app/api/bio/go/[id]/route.ts")).toContain("ehRobo(");
    expect(ler("src/app/bio/[slug]/page.tsx")).toContain("ehRobo(");
  });
});

// ---------------------------------------------------------------------------
describe("faturamento por canal/campanha é PAGO, e conversão é do servidor", () => {
  const insights = ler("src/lib/tracking/insights.ts");
  const engine = ler("src/lib/tracking/engine.ts");
  const rotaPedido = ler("src/app/api/catalog/order/route.ts");

  it("o ranking soma netTotal de pedido pago ligado à sessão — nunca a sacola", () => {
    expect(insights).toContain("faturamentoPagoPorSessao");
    // o jeito antigo (cartValue como faturamento) não pode voltar
    expect(insights).not.toContain("row.revenue += s.cartValue");
    expect(insights).not.toContain("orders.reduce((a, s) => a + s.cartValue");
  });

  it("o pedido do catálogo guarda a sessão que o gerou (validada na loja)", () => {
    expect(ler("prisma/schema.prisma")).toContain("trackSessionId String?");
    expect(rotaPedido).toContain("trackSessionId");
    expect(rotaPedido).toContain("companyId: company.id");
  });

  it("conversão é marcada UMA vez, pelo servidor do pedido — não pelo navegador", () => {
    // a rota marca ao CRIAR (reenvio do mesmo protocolo não passa por aqui)
    expect(rotaPedido).toContain("converted: true");
    // o motor de eventos parou de marcar pelo order_submitted
    expect(engine).not.toContain("converted: true");
  });
});
