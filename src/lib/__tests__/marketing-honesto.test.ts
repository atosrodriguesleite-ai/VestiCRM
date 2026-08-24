import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { carrinhosAbandonados, periodFromDays } from "../tracking/insights";
import { classifyChannel } from "../tracking/engine";
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

  // Auditoria 24/08/2026: a lista mandava a loja cobrar sacola JÁ VENDIDA —
  // "você esqueceu suas peças" para quem tinha acabado de pagar.
  it("quem abandonou mas ENVIOU o pedido em outra visita não é abandono", () => {
    const out = carrinhosAbandonados([
      sessao({ startedAt: new Date("2026-08-01T10:00:00Z") }),
      sessao({ converted: true, startedAt: new Date("2026-08-02T10:00:00Z") }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("cliente identificada que PAGOU depois (WhatsApp, manual) sai da lista", () => {
    const compras = new Map([["cli-1", [new Date("2026-08-02T10:00:00Z")]]]);
    const out = carrinhosAbandonados(
      [sessao({ customerId: "cli-1", startedAt: new Date("2026-08-01T10:00:00Z") })],
      compras
    );
    expect(out).toHaveLength(0);
  });

  it("compra ANTIGA não resolve sacola nova: comprou, voltou e encheu de novo", () => {
    const compras = new Map([["cli-1", [new Date("2026-07-20T10:00:00Z")]]]);
    const out = carrinhosAbandonados(
      [sessao({ customerId: "cli-1", startedAt: new Date("2026-08-01T10:00:00Z") })],
      compras
    );
    expect(out).toHaveLength(1);
  });

  it("quem converteu DEPOIS do período também sai (mês fechado não mente)", () => {
    // sessão de 30/07 dentro do recorte de julho; o envio do pedido foi 02/08
    const conversoes = new Map([["v1", [new Date("2026-08-02T09:00:00Z")]]]);
    const out = carrinhosAbandonados(
      [sessao({ startedAt: new Date("2026-07-30T10:00:00Z") })],
      new Map(),
      conversoes
    );
    expect(out).toHaveLength(0);
  });

  it("KPI e lista de recuperação usam a MESMA régua (compras pagas + conversões)", () => {
    const fonte = ler("src/lib/tracking/insights.ts");
    // as duas chamadas passam os mapas do banco — sem eles a régua descasa
    const chamadas = fonte.match(/carrinhosAbandonados\(sessions, comprasPagas, conversoes\)/g) ?? [];
    expect(chamadas.length).toBe(2);
    // e o "quase comprando" também não cutuca quem já decidiu
    expect(fonte).toContain("sessaoResolvida(s, conversoes, comprasPagas)");
    // as conversões vêm SEM teto de período (só piso) — pedido enviado depois
    // do recorte resolve a sacola de dentro dele
    expect(fonte).toContain("converted: true, startedAt: { gte: desde }");
  });

  it("a esteira de Recuperação (robô do WhatsApp) segue a mesma regra", () => {
    const esteira = ler("src/lib/recuperacao.ts");
    // não CRIA carrinho para quem pediu depois da sacola (qualquer porta)…
    expect(esteira).toContain('status: { not: "CANCELADO" }');
    expect(esteira).toContain("o.createdAt > s.lastEventAt");
    // …e não MANDA mensagem se o pedido nasceu entre a varredura e o envio
    expect(esteira).toContain("o.createdAt > cart.abandonedAt");
    // o carrinho pulado fica SEM carimbo (a tela mostraria "automática
    // enviada" mentirosa) e segue na fila humana
    expect(esteira).toContain("candidatos.filter((c) => !jaPediu.has(c.id))");
  });

  it("a sacola mostrada na Inteligência é a MESMA da esteira de Recuperação", () => {
    const fonte = ler("src/lib/tracking/insights.ts");
    // fonte única (lib/recuperacao.ts): foto do evento e, sem foto, a
    // reconstrução com a peneira do tamanho composto — a remontagem antiga
    // daqui errava quantidade e divergia da tela Recuperação
    expect(fonte).toContain("sacolaDaFoto");
    expect(fonte).toContain('sacolaDosEventos(evs).filter((i) => !i.size?.includes(","))');
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
describe("Lote 2: canal Bio, dia SP, jornada por pessoa e utm_campaign vivo", () => {
  it("a bio existe como canal (utm_source=bio não vira 'Site')", () => {
    expect(classifyChannel({ utmSource: "bio" })).toBe("bio");
    expect(classifyChannel({ utmSource: "BIO" })).toBe("bio");
    // sem a etiqueta, nada muda
    expect(classifyChannel({ referer: "https://instagram.com/x" })).toBe("instagram");
  });

  it("'Hoje' da Inteligência é o DIA de São Paulo (não as últimas 24h)", () => {
    const p = periodFromDays(1);
    // começo do dia SP = T03:00Z do dia corrente — nunca mais de 24h atrás
    expect(p.to.getTime() - p.from.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(p.from.toISOString().endsWith("T03:00:00.000Z")).toBe(true);
  });

  it("a jornada da bio conta 1 pessoa = 1 sacola (função única nas duas telas)", () => {
    const jornada = ler("src/lib/bio-jornada.ts");
    expect(jornada).toContain("visitorId");
    expect(ler("src/app/(app)/marketing/bio/page.tsx")).toContain("jornadaDaBio(");
    expect(ler("src/app/api/marketing/bio/report/route.ts")).toContain("jornadaDaBio(");
  });

  it("?utm_campaign atribui a campanha — só a quem ainda não tem", () => {
    const engine = ler("src/lib/tracking/engine.ts");
    expect(engine).toContain("atribuirCampanhaPorUtm");
    // regra do primeiro contato: nunca sobrescreve campanha existente
    expect(engine).toContain("campaignId: null");
    expect(ler("src/app/api/catalog/order/route.ts")).toContain("atribuirCampanhaPorUtm(");
  });

  it("trocar só a grade (mesma quantidade) não infla o +Sacola", () => {
    expect(ler("src/app/catalogo/[slug]/public-catalog.tsx")).toContain(
      "if (newQty !== prevQty)"
    );
  });

  it("unificar contatos repõe também o visitante do tracking (sem fantasma)", () => {
    expect(ler("src/lib/merge-contacts.ts")).toContain("tx.visitor.updateMany");
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
