import { describe, it, expect } from "vitest";
import { itemVisivel } from "../menu-grupos";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALERTA_TRAVA_PCT, calcularMonitor, estadoDaTrava, mesSP } from "../ia";

/**
 * IA DE VENDAS — Entrega 1 (01/08/2026): Cérebro treinável + trava de uso
 * por loja + Monitor de Equipe. Pedidos do dono que estas regras guardam:
 * módulo pago à parte (Super Admin liga por loja), trava de conversas/mês
 * ("cliente contratou 1.000 e usou 3.000" não pode virar prejuízo) e
 * relatórios ao dono PRONTOS mas DESLIGADOS.
 */

describe("mês no calendário de São Paulo", () => {
  it("madrugada UTC do dia 1º ainda é o mês anterior em SP", () => {
    // 01/08 02h UTC = 31/07 23h em SP
    expect(mesSP(new Date("2026-08-01T02:00:00Z"))).toBe("2026-07");
    expect(mesSP(new Date("2026-08-01T12:00:00Z"))).toBe("2026-08");
  });
});

describe("a trava de uso (o plano vendido para a loja)", () => {
  it("dentro do plano: nada trava, nada alerta", () => {
    const t = estadoDaTrava(1000, 300);
    expect(t.estourou).toBe(false);
    expect(t.alerta).toBe(false);
    expect(t.restantes).toBe(700);
  });

  it("em 80% acende o alerta (hora de vender upgrade, ANTES de travar)", () => {
    expect(ALERTA_TRAVA_PCT).toBe(0.8);
    expect(estadoDaTrava(1000, 800).alerta).toBe(true);
    expect(estadoDaTrava(1000, 800).estourou).toBe(false);
  });

  it("no teto, trava — o cenário do dono: contratou 1.000, usou 3.000", () => {
    const t = estadoDaTrava(1000, 3000);
    expect(t.estourou).toBe(true);
    expect(t.restantes).toBe(0); // nunca negativo
  });

  it("limite zero = sempre travada (loja sem plano não usa IA)", () => {
    expect(estadoDaTrava(0, 0).estourou).toBe(true);
  });
});

describe("Monitor de Equipe — a conta pura", () => {
  const ana = { id: "ana", name: "Ana", color: "#f00" };
  const bia = { id: "bia", name: "Bia", color: "#00f" };
  const d = (s: string) => new Date(s);

  it("tempo de resposta: IN → OUT pareado, e mensagens seguidas da cliente NÃO zeram o cronômetro", () => {
    const m = calcularMonitor(
      [ana],
      [
        { conversationId: "c1", direction: "IN", createdAt: d("2026-08-01T13:00:00Z"), authorId: null },
        { conversationId: "c1", direction: "IN", createdAt: d("2026-08-01T13:05:00Z"), authorId: null },
        { conversationId: "c1", direction: "OUT", createdAt: d("2026-08-01T13:10:00Z"), authorId: "ana" },
      ],
      [{ id: "c1", assigneeId: "ana", lastInboundAt: null, lastOutboundAt: null }],
      [],
      []
    );
    // conta desde a PRIMEIRA fala sem resposta: 10 min, não 5
    expect(m.vendedoras[0].mediaRespostaMin).toBe(10);
    expect(m.vendedoras[0].conversas).toBe(1);
    expect(m.vendedoras[0].respostas).toBe(1);
  });

  it("resposta com mais de 24h fica FORA da média (madrugada/fim de semana não é demora)", () => {
    const m = calcularMonitor(
      [ana],
      [
        { conversationId: "c1", direction: "IN", createdAt: d("2026-08-01T10:00:00Z"), authorId: null },
        { conversationId: "c1", direction: "OUT", createdAt: d("2026-08-03T10:00:00Z"), authorId: "ana" },
      ],
      [{ id: "c1", assigneeId: "ana", lastInboundAt: null, lastOutboundAt: null }],
      [],
      []
    );
    expect(m.vendedoras[0].mediaRespostaMin).toBeNull();
    // mas a resposta em si conta como trabalho
    expect(m.vendedoras[0].respostas).toBe(1);
  });

  it("mensagem sem autor é atribuída à DONA da conversa", () => {
    const m = calcularMonitor(
      [ana],
      [
        { conversationId: "c1", direction: "IN", createdAt: d("2026-08-01T10:00:00Z"), authorId: null },
        { conversationId: "c1", direction: "OUT", createdAt: d("2026-08-01T10:06:00Z"), authorId: null },
      ],
      [{ id: "c1", assigneeId: "ana", lastInboundAt: null, lastOutboundAt: null }],
      [],
      []
    );
    expect(m.vendedoras[0].mediaRespostaMin).toBe(6);
  });

  it("cliente esperando AGORA: conta para a dona; sem dona, vai para a fila", () => {
    const agora = d("2026-08-01T12:00:00Z");
    const m = calcularMonitor(
      [ana],
      [],
      [
        // Ana deve resposta há 30 min
        { id: "c1", assigneeId: "ana", lastInboundAt: d("2026-08-01T11:30:00Z"), lastOutboundAt: d("2026-08-01T11:00:00Z") },
        // conversa da fila (sem dona) há 90 min
        { id: "c2", assigneeId: null, lastInboundAt: d("2026-08-01T10:30:00Z"), lastOutboundAt: null },
        // já respondida: não conta
        { id: "c3", assigneeId: "ana", lastInboundAt: d("2026-08-01T11:00:00Z"), lastOutboundAt: d("2026-08-01T11:10:00Z") },
      ],
      [],
      [],
      agora
    );
    expect(m.vendedoras[0].aguardandoAgora).toBe(1);
    expect(m.vendedoras[0].maiorEsperaMin).toBe(30);
    expect(m.fila).toEqual({ aguardando: 1, maiorEsperaMin: 90 });
  });

  it("vendas somam netTotal (sem frete), conversão = pedidos ÷ conversas, e quem vende mais vem primeiro", () => {
    const m = calcularMonitor(
      [ana, bia],
      [
        { conversationId: "c1", direction: "OUT", createdAt: d("2026-08-01T10:00:00Z"), authorId: "ana" },
        { conversationId: "c2", direction: "OUT", createdAt: d("2026-08-01T10:00:00Z"), authorId: "ana" },
        { conversationId: "c3", direction: "OUT", createdAt: d("2026-08-01T10:00:00Z"), authorId: "bia" },
      ],
      [],
      [
        { sellerId: "bia", netTotal: 900 }, // frete-ok: netTotal É a régua sem frete
        { sellerId: "ana", netTotal: 400 },
        { sellerId: null, netTotal: 999 }, // pedido da loja: não é de ninguém
      ],
      [{ assigneeId: "ana" }]
    );
    expect(m.vendedoras[0].nome).toBe("Bia"); // vendeu mais
    expect(m.vendedoras[0].vendido).toBe(900);
    expect(m.vendedoras[0].conversaoPct).toBe(100); // 1 pedido ÷ 1 conversa
    expect(m.vendedoras[1].conversaoPct).toBe(50); // 1 pedido ÷ 2 conversas
    expect(m.vendedoras[1].tarefasAtrasadas).toBe(1);
  });
});

describe("o módulo está amarrado (guardas de arquivo)", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("a chave do módulo NASCE DESLIGADA e os comportamentos também", () => {
    const schema = ler("prisma/schema.prisma");
    expect(schema).toContain('aiSalesEnabled    Boolean  @default(false)');
    expect(schema).toContain("atendente Boolean @default(false)");
    expect(schema).toContain("copilot   Boolean @default(false)");
    // decisão do dono (01/08): relatórios prontos, mas DESLIGADOS
    expect(schema).toContain("relatoriosAoDono Boolean @default(false)");
  });

  it("só o Super Admin liga o módulo (espelho dos outros módulos pagos)", () => {
    const rota = ler("src/app/api/companies/ai-sales/route.ts");
    expect(rota).toContain('user.role !== "SUPERADMIN"');
    expect(rota).toContain("aiSalesEnabled: parsed.data.enabled");
  });

  it("sem a chave, o menu não mostra e a tela expulsa", () => {
    // o item do menu declara a chave do módulo, e a regra de quem vê é pura
    // (`itemVisivel`): sem a chave ninguém vê, nem a admin
    expect(ler("src/components/app-shell.tsx")).toMatch(
      /href: "\/ia",[^}]*aiOnly: true/
    );
    const item = { href: "/ia", managerOnly: true, aiOnly: true };
    expect(itemVisivel(item, { role: "ADMIN", aiSalesEnabled: false })).toBe(false);
    expect(itemVisivel(item, { role: "ADMIN", aiSalesEnabled: true })).toBe(true);
    expect(itemVisivel(item, { role: "SELLER", aiSalesEnabled: true })).toBe(false);
    const page = ler("src/app/(app)/ia/page.tsx");
    expect(page).toContain("if (!company?.aiSalesEnabled) redirect(");
    expect(page).toContain("if (!isManagerUp(user)) redirect(");
  });

  it("o limite do plano só a plataforma altera (a loja não aumenta o próprio teto)", () => {
    const rota = ler("src/app/api/ia/config/route.ts");
    expect(rota).toContain('limiteConversasMes !== undefined && user.role !== "SUPERADMIN"');
  });

  it("o Monitor usa a régua oficial de venda (pedido pago + netTotal)", () => {
    const lib = ler("src/lib/ia.ts");
    expect(lib).toContain("PAID_ORDER_STATUSES");
    expect(lib).toContain("netTotal");
    expect(lib).toContain("inicioDoMesSP");
  });

  it("o módulo tem preço de tabela (entra no MRR do painel)", () => {
    expect(ler("src/lib/modulos.ts")).toContain('"IA_VENDAS"');
    expect(ler("src/lib/modulos.ts")).toContain('flag: "aiSalesEnabled"');
  });

  it("o painel Lojas tem a chavinha", () => {
    expect(ler("src/app/(app)/lojas/lojas-view.tsx")).toContain("/api/companies/ai-sales");
  });
});
