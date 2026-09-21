import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OrderStatus } from "@prisma/client";
import {
  casaFiltroDeSelo,
  contarPedidos,
  explicacaoDoSelo,
  infoDoSelo,
  rotuloDoSelo,
  seloDaCliente,
  STATUS_EM_ABERTO,
} from "../selo-da-cliente";
import { PAID_ORDER_STATUSES } from "../orders";

// BANCO SIMULADO — a régua da consulta (loja, cancelado fora, distinct,
// recorte) é conferida pelo COMPORTAMENTO, não pelo texto do código
type Pedido = { customerId: string; status: OrderStatus; companyId: string; updatedAt?: Date };
type Conversa = { customerId: string; companyId: string; assigneeId: string | null };
const banco = { order: [] as Pedido[], conversation: [] as Conversa[] };
const chamadas: { metodo: string; args: Record<string, unknown> }[] = [];
vi.mock("../db", () => ({
  db: {
    order: {
      async groupBy(args: {
        by: string[];
        where: { companyId: string; customerId?: { in: string[] }; status?: { not: string }; updatedAt?: { gt: Date } };
        take?: number;
      }) {
        chamadas.push({ metodo: "order.groupBy", args });
        const w = args.where;
        const linhas = banco.order.filter(
          (o) =>
            o.companyId === w.companyId &&
            (!w.customerId || w.customerId.in.includes(o.customerId)) &&
            (!w.status || o.status !== w.status.not) &&
            (!w.updatedAt || (o.updatedAt ?? new Date(0)) > w.updatedAt.gt)
        );
        const grupos = new Map<string, { customerId: string; status: OrderStatus; n: number }>();
        for (const o of linhas) {
          const k = args.by.map((b) => (o as unknown as Record<string, string>)[b]).join("|");
          const g = grupos.get(k) ?? { customerId: o.customerId, status: o.status, n: 0 };
          g.n++;
          grupos.set(k, g);
        }
        const out = [...grupos.values()].map((g) =>
          args.by.includes("status")
            ? { customerId: g.customerId, status: g.status, _count: { _all: g.n } }
            : { customerId: g.customerId }
        );
        return args.take ? out.slice(0, args.take) : out;
      },
    },
    conversation: {
      async findMany(args: { where: { companyId: string; customerId: { in: string[] }; OR?: { assigneeId: string | null }[] } }) {
        chamadas.push({ metodo: "conversation.findMany", args });
        const w = args.where;
        const vistos = new Set<string>();
        return banco.conversation
          .filter(
            (c) =>
              c.companyId === w.companyId &&
              w.customerId.in.includes(c.customerId) &&
              (!w.OR || w.OR.some((o) => o.assigneeId === c.assigneeId))
          )
          .filter((c) => (vistos.has(c.customerId) ? false : (vistos.add(c.customerId), true)))
          .map((c) => ({ customerId: c.customerId }));
      },
      async updateMany(args: Record<string, unknown>) {
        chamadas.push({ metodo: "conversation.updateMany", args });
        return { count: 0 };
      },
    },
  },
}));
import { db } from "../db";
import {
  selosDosClientes,
  selosMexidosDesde,
  tocarConversasDaCliente,
  TETO_SELOS_POR_SYNC,
} from "../selo-da-cliente-data";

// Guarda RN-063
//
// SELO DA CLIENTE NA CENTRAL (pedido do dono, 21/09/2026): Pedido (amarelo,
// tem pedido em aberto e nenhum pago), Cliente (verde, 1 pedido pago) e
// Recompra (verde com setinhas, 2+ pagos) — CALCULADO dos pedidos, nunca
// gravado nem colocado na mão; muda sozinho na tela aberta pelo sync.

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("o selo é calculado dos pedidos (RN-001 decide o que é pago)", () => {
  it("nada → sem selo (só conversa é lead, e a ausência é informação)", () => {
    expect(seloDaCliente({ pagos: 0, abertos: 0 })).toBeNull();
  });

  it("pedido em aberto sem nenhum pago → PEDIDO", () => {
    expect(seloDaCliente({ pagos: 0, abertos: 1 })).toBe("PEDIDO");
    expect(seloDaCliente({ pagos: 0, abertos: 3 })).toBe("PEDIDO");
  });

  it("um pedido pago → CLIENTE, mesmo com outro em aberto (o selo diz quem ela É)", () => {
    expect(seloDaCliente({ pagos: 1, abertos: 0 })).toBe("CLIENTE");
    expect(seloDaCliente({ pagos: 1, abertos: 2 })).toBe("CLIENTE");
  });

  it("dois ou mais pagos → RECOMPRA (o dono pediu: 'quem tem duas compras pagas')", () => {
    expect(seloDaCliente({ pagos: 2, abertos: 0 })).toBe("RECOMPRA");
    expect(seloDaCliente({ pagos: 7, abertos: 1 })).toBe("RECOMPRA");
  });

  it("'em aberto' é DERIVADO do enum: tudo que não é pago nem cancelado", () => {
    const esperado = Object.values(OrderStatus).filter(
      (s) => s !== "CANCELADO" && !PAID_ORDER_STATUSES.includes(s)
    );
    expect(STATUS_EM_ABERTO).toEqual(esperado);
    // e hoje isso é exatamente orçamento + aguardando pagamento
    expect(STATUS_EM_ABERTO).toEqual(["ORCAMENTO", "AGUARDANDO_PAGAMENTO"]);
    // nenhum status do enum fica sem casa (pago, aberto ou cancelado)
    for (const s of Object.values(OrderStatus)) {
      const casas = [
        PAID_ORDER_STATUSES.includes(s),
        STATUS_EM_ABERTO.includes(s),
        s === "CANCELADO",
      ].filter(Boolean).length;
      expect(casas, s).toBe(1);
    }
  });
});

describe("contagem por cliente a partir do groupBy", () => {
  it("soma pagos e abertos por cliente; cancelado não conta para nada", () => {
    const por = contarPedidos([
      { customerId: "a", status: "PAGO", n: 1 },
      { customerId: "a", status: "ENTREGUE", n: 2 },
      { customerId: "a", status: "ORCAMENTO", n: 1 },
      { customerId: "a", status: "CANCELADO", n: 5 },
      { customerId: "b", status: "AGUARDANDO_PAGAMENTO", n: 1 },
      { customerId: "c", status: "CANCELADO", n: 1 },
    ]);
    expect(por.get("a")).toEqual({ pagos: 3, abertos: 1 });
    expect(por.get("b")).toEqual({ pagos: 0, abertos: 1 });
    // quem só tem cancelado aparece zerado → sem selo
    expect(infoDoSelo(por.get("c")).selo).toBeNull();
    expect(infoDoSelo(por.get("a")).selo).toBe("RECOMPRA");
    expect(infoDoSelo(por.get("b")).selo).toBe("PEDIDO");
  });

  it("cliente que não veio no groupBy fica zerado, sem selo", () => {
    expect(infoDoSelo(undefined)).toEqual({ pagos: 0, abertos: 0, selo: null });
  });

  it("todo status pago da RN-001 conta como compra", () => {
    for (const s of PAID_ORDER_STATUSES) {
      const por = contarPedidos([{ customerId: "x", status: s, n: 1 }]);
      expect(por.get("x")?.pagos, s).toBe(1);
    }
  });
});

describe("os chips de filtro", () => {
  it("'Clientes' inclui a recompra; 'Recompra' só quem voltou; 'Com pedido' só quem não pagou", () => {
    expect(casaFiltroDeSelo("CLIENTE", "CLIENTES")).toBe(true);
    expect(casaFiltroDeSelo("RECOMPRA", "CLIENTES")).toBe(true);
    expect(casaFiltroDeSelo("PEDIDO", "CLIENTES")).toBe(false);
    expect(casaFiltroDeSelo("RECOMPRA", "RECOMPRA")).toBe(true);
    expect(casaFiltroDeSelo("CLIENTE", "RECOMPRA")).toBe(false);
    expect(casaFiltroDeSelo("PEDIDO", "PEDIDO")).toBe(true);
    expect(casaFiltroDeSelo("CLIENTE", "PEDIDO")).toBe(false);
    expect(casaFiltroDeSelo(null, "CLIENTES")).toBe(false);
    expect(casaFiltroDeSelo(undefined, "PEDIDO")).toBe(false);
  });
});

describe("o que a tela escreve", () => {
  it("rótulo com o número quando ele diz algo", () => {
    expect(rotuloDoSelo({ pagos: 0, abertos: 1, selo: "PEDIDO" })).toBe("Pedido");
    expect(rotuloDoSelo({ pagos: 0, abertos: 2, selo: "PEDIDO" })).toBe("2 pedidos");
    expect(rotuloDoSelo({ pagos: 1, abertos: 0, selo: "CLIENTE" })).toBe("Cliente");
    expect(rotuloDoSelo({ pagos: 3, abertos: 0, selo: "RECOMPRA" })).toBe("Cliente · 3 compras");
    expect(rotuloDoSelo({ pagos: 0, abertos: 0, selo: null })).toBe("");
  });

  it("a explicação diz que o selo é calculado — para ninguém tentar tirar na mão", () => {
    expect(explicacaoDoSelo({ pagos: 2, abertos: 0, selo: "RECOMPRA" })).toMatch(/não se coloca nem se tira na mão/);
    expect(explicacaoDoSelo({ pagos: 1, abertos: 0, selo: "CLIENTE" })).toMatch(/1 pedido pago/);
    expect(explicacaoDoSelo({ pagos: 0, abertos: 1, selo: "PEDIDO" })).toMatch(/Vira "Cliente"/);
  });
});

describe("a consulta (banco simulado): recorte, cancelado fora e o sync por quem viu pedido mexido", () => {
  it("selosDosClientes: só a loja, só os ids pedidos, cancelado fora — e quem não veio fica zerado", async () => {
    chamadas.length = 0;
    banco.order = [
      { customerId: "a", status: "PAGO", companyId: "loja1" },
      { customerId: "a", status: "ENTREGUE", companyId: "loja1" },
      { customerId: "a", status: "CANCELADO", companyId: "loja1" },
      { customerId: "b", status: "ORCAMENTO", companyId: "loja1" },
      { customerId: "c", status: "PAGO", companyId: "loja1" },
      { customerId: "a", status: "PAGO", companyId: "OUTRA" }, // RN-013
    ];
    const por = await selosDosClientes("loja1", ["a", "b", "z", "a"]);
    expect(por.get("a")).toEqual({ pagos: 2, abertos: 0, selo: "RECOMPRA" });
    expect(por.get("b")).toEqual({ pagos: 0, abertos: 1, selo: "PEDIDO" });
    expect(por.get("z")).toEqual({ pagos: 0, abertos: 0, selo: null });
    expect(por.has("c")).toBe(false); // não foi pedido
    // uma ida ao banco para a lista inteira, recortada pela loja
    const g = chamadas.filter((c) => c.metodo === "order.groupBy");
    expect(g).toHaveLength(1);
    expect(g[0].args.where).toMatchObject({ companyId: "loja1", status: { not: "CANCELADO" } });
  });

  it("selosDosClientes sem ids não vai ao banco", async () => {
    chamadas.length = 0;
    expect((await selosDosClientes("loja1", [])).size).toBe(0);
    expect(chamadas).toHaveLength(0);
  });

  it("selosMexidosDesde: pelo updatedAt, DISTINCT no banco, e só clientes com conversa no RECORTE de quem vê", async () => {
    chamadas.length = 0;
    const since = new Date("2026-09-21T10:00:00Z");
    banco.order = [
      { customerId: "a", status: "PAGO", companyId: "loja1", updatedAt: new Date("2026-09-21T10:00:05Z") },
      { customerId: "a", status: "ORCAMENTO", companyId: "loja1", updatedAt: new Date("2026-09-21T10:00:06Z") },
      { customerId: "b", status: "PAGO", companyId: "loja1", updatedAt: new Date("2026-09-21T10:00:07Z") },
      { customerId: "c", status: "PAGO", companyId: "loja1", updatedAt: new Date("2026-09-21T09:00:00Z") }, // antes
      { customerId: "d", status: "PAGO", companyId: "OUTRA", updatedAt: new Date("2026-09-21T10:00:08Z") }, // outra loja
    ];
    // a vendedora vê só as conversas dela + a fila: "a" é dela, "b" é da colega
    banco.conversation = [
      { customerId: "a", companyId: "loja1", assigneeId: "vend1" },
      { customerId: "a", companyId: "loja1", assigneeId: null },
      { customerId: "b", companyId: "loja1", assigneeId: "vend2" },
    ];
    const vendedora = { id: "vend1", companyId: "loja1", role: "SELLER", chatVisaoTotal: false } as never;
    const r = await selosMexidosDesde(vendedora, since);
    expect(r).toEqual([{ customerId: "a", pagos: 1, abertos: 1, selo: "CLIENTE" }]);
    // o "de quem" é um groupBy por cliente (distinct no banco), com teto
    const g = chamadas.find((c) => c.metodo === "order.groupBy");
    expect(g?.args).toMatchObject({ by: ["customerId"], take: TETO_SELOS_POR_SYNC, where: { companyId: "loja1", updatedAt: { gt: since } } });
    // gerência vê a loja inteira: "b" entra também
    const gerente = { id: "ger", companyId: "loja1", role: "MANAGER" } as never;
    const r2 = await selosMexidosDesde(gerente, since);
    expect(r2.map((x) => x.customerId).sort()).toEqual(["a", "b"]);
  });

  it("selosMexidosDesde sem pedido mexido não procura conversa nem selo", async () => {
    chamadas.length = 0;
    banco.order = [];
    expect(await selosMexidosDesde({ id: "ger", companyId: "loja1", role: "MANAGER" } as never, new Date())).toEqual([]);
    expect(chamadas.map((c) => c.metodo)).toEqual(["order.groupBy"]);
  });

  it("tocarConversasDaCliente toca só as conversas DAQUELA cliente, DAQUELA loja", async () => {
    chamadas.length = 0;
    await tocarConversasDaCliente(db as never, "loja1", "a");
    const u = chamadas.find((c) => c.metodo === "conversation.updateMany");
    expect(u?.args.where).toEqual({ companyId: "loja1", customerId: "a" });
    expect((u?.args.data as { updatedAt: Date }).updatedAt).toBeInstanceOf(Date);
  });
});

describe("as portas por onde o pedido some da cliente tocam as conversas dela", () => {
  it("apagar (funil único) e transferir para outra cliente (PATCH do pedido)", () => {
    expect(ler("src/lib/order-actions.ts")).toContain("tocarConversasDaCliente(tx, order.companyId, order.customerId)");
    expect(ler("src/app/api/orders/[id]/route.ts")).toContain("tocarConversasDaCliente(db, user.companyId, order.customerId)");
  });
});

describe("o selo chega à tela e muda SOZINHO", () => {
  it("a lista, o sync, a busca e a abertura passam TODOS pelo mesmo mapeamento", () => {
    const data = ler("src/lib/inbox-data.ts");
    expect(data).toContain("selosDosClientes(");
    expect(data).toContain("infoDoSelo(undefined)");
  });

  it("o sync devolve o selo de quem teve pedido mexido e a tela aplica ANTES do atalho 'nada mudou'", () => {
    const rota = ler("src/app/api/conversations/route.ts");
    expect(rota).toContain("selosMexidosDesde(user, desde)");
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    const aplica = tela.indexOf("porCliente.get(c.customer.id)");
    const atalho = tela.indexOf("if (d.conversations.length === 0) return;");
    expect(aplica).toBeGreaterThan(0);
    expect(atalho).toBeGreaterThan(aplica);
  });

  it("os dois índices existem no schema, cada um numa migração com UMA instrução CONCURRENTLY", () => {
    const schema = ler("prisma/schema.prisma");
    expect(schema).toMatch(/model Order \{[^}]*@@index\(\[companyId, updatedAt\]\)/);
    expect(schema).toMatch(/model Order \{[^}]*@@index\(\[companyId, customerId\]\)/);
    for (const [sufixo, esperado] of [
      ["_order_company_updated_idx", '"Order_companyId_updatedAt_idx" ON "Order"("companyId", "updatedAt")'],
      ["_order_company_customer_idx", '"Order_companyId_customerId_idx" ON "Order"("companyId", "customerId")'],
    ]) {
      const pasta = readdirSync(join(process.cwd(), "prisma/migrations")).find((d) => d.endsWith(sufixo));
      expect(pasta, sufixo).toBeTruthy();
      const instrucoes = ler(`prisma/migrations/${pasta}/migration.sql`)
        .split("\n")
        .filter((l) => l.trim() && !l.trim().startsWith("--"));
      expect(instrucoes).toHaveLength(1);
      expect(instrucoes[0]).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS " + esperado);
    }
  });

  it("o selo do sistema aparece na linha da lista e no cabeçalho, sem × (não se tira na mão)", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(tela).toContain("<SeloDaClientePill info={c.customer} />");
    expect(tela).toContain('<SeloDaClientePill info={selected.customer} tamanho="md" />');
    const pill = ler("src/components/selo-da-cliente.tsx");
    expect(pill).not.toContain("<X ");
    expect(pill).toContain('aria-label="recompra"');
  });
});
