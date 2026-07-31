import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PENTE FINO DAS MÉTRICAS (31/07/2026) — pedido do dono: "veja se essas
 * métricas fazem sentido". Não faziam, em sete pontos. Este guarda impede
 * cada um de voltar.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const relatorios = ler("src/app/(app)/relatorios/page.tsx");
const segments = ler("src/lib/segments.ts");
const exportClientes = ler("src/app/api/export/clientes/route.ts");
const ficha = ler("src/app/(app)/clientes/[id]/page.tsx");
const fichaApi = ler("src/app/api/customers/[id]/route.ts");

describe("Relatórios: inativo é quem PAROU de comprar, não quem nunca comprou", () => {
  it("os dois grupos são separados", () => {
    // antes, 209 leads sem compra entravam como 'inativos 30/60/90' ao mesmo
    // tempo e o cartão mostrava o mesmo número três vezes
    expect(relatorios).toContain("const compradores = allCustomers.filter((c) => c.orders.length > 0)");
    expect(relatorios).toContain("leadsSemCompra");
    expect(relatorios).toContain('label="Pararam de comprar (60d+)"');
  });

  it("a última compra vem DOS PEDIDOS PAGOS, não do carimbo lastPurchaseAt", () => {
    // o carimbo não é gravado em todos os caminhos (217 − 7 ≠ 209)
    expect(relatorios).not.toContain("lastPurchaseAt: {");
    expect(relatorios).not.toContain("c.lastPurchaseAt <");
    expect(relatorios).toContain("const ultimaCompra = (c:");
  });
});

describe("Relatórios: ticket médio é por PEDIDO", () => {
  it("divide o faturamento pelos pedidos, não pelos clientes", () => {
    // dividir por clientes infla o ticket assim que alguém recompra —
    // e recompra é justamente a graça do atacado
    expect(relatorios).toContain("c.revenue / c.orders");
    expect(relatorios).not.toContain("c.revenue / c.buyers");
  });
});

describe("Relatórios: canais de aquisição seguem o período da tela", () => {
  it("leads, valor e conversão são do período (não mais 'histórico' ao lado de faturamento do período)", () => {
    expect(relatorios).toContain("chegouNoPeriodo");
    expect(relatorios).toContain("pagosNoPeriodo");
    // os títulos dizem o período em vez de '· histórico'
    expect(relatorios).toContain("Leads por origem <span");
    expect(relatorios).not.toContain("Leads por origem <span className=\"text-xs font-normal text-gray-400\">· histórico");
  });
});

describe("Relatórios: tarefas ATRASADAS, não toda tarefa pendente da história", () => {
  it("conta só o que venceu e não foi feito", () => {
    expect(relatorios).toContain('status: "PENDENTE", dueAt: { lt: now }');
    expect(relatorios).toContain('label="Tarefas atrasadas"');
  });
});

describe("Relatórios: 1ª resposta sem carregar a loja inteira", () => {
  it("usa agregação no banco, não todas as mensagens na memória", () => {
    // com 120 mil mensagens (escala já medida) a tela não abriria
    expect(relatorios).toContain('db.message.groupBy');
    expect(relatorios).not.toContain("db.conversation.findMany");
  });

  it("nota interna não conta como resposta", () => {
    expect(relatorios).toContain('kind: "TEXT"');
  });

  it("o rodapé usa o MESMO denominador da média", () => {
    expect(relatorios).toContain("responseTimes.length} conversa");
    expect(relatorios).not.toContain("conversations.length} conversas analisadas");
  });
});

describe("Relatórios: português direito", () => {
  it("'1 dia' no singular", () => {
    expect(relatorios).toContain('v === 1 ? "dia" : "dias"');
    expect(relatorios).not.toContain(".toFixed(0)} dias");
  });

  it("negociação ganha não vira 'pedido ganho'", () => {
    expect(relatorios).not.toContain("pedidos ganhos");
  });
});

describe("Campanhas (segmentos): 'sem compra há X dias' fala a verdade", () => {
  it("olha os pedidos pagos, não o carimbo", () => {
    // cliente que COMPROU podia receber "sentimos sua falta"
    expect(segments).not.toContain("lastPurchaseAt: { lt: cutoff }");
    expect(segments).toContain("orders = {");
    expect(segments).toContain("none: {");
  });

  it("lead recém-chegado não entra na reativação", () => {
    expect(segments).toContain("where.createdAt = { lt: cutoff }");
  });

  it("total gasto por netTotal (sem frete)", () => {
    expect(segments).toContain("s + v.netTotal");
    expect(segments).not.toContain("s + v.total,");
  });
});

describe("mesma cliente, mesmo número em toda tela", () => {
  it("ficha do cliente soma netTotal (igual ao ranking de mais valiosos)", () => {
    expect(ficha).toContain("paidOrders.reduce((s, v) => s + v.netTotal, 0)");
  });

  it("exportação de clientes soma netTotal e deriva a última compra dos pedidos", () => {
    expect(exportClientes).toContain("s + v.netTotal");
    expect(exportClientes).not.toContain("c.lastPurchaseAt\n");
    expect(exportClientes).toContain("o.paidAt && (!max || o.paidAt > max)");
  });

  it("painel do WhatsApp recebe a última compra real (máximo de paidAt)", () => {
    expect(fichaApi).toContain("_max: { paidAt: true }");
    expect(fichaApi).toContain("agg._max.paidAt");
  });
});
