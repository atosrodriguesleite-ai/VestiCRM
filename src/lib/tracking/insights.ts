import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";

/**
 * API de leitura da Tracking Engine.
 * TODOS os relatórios da Inteligência Comercial consomem estas funções
 * (ou GET /api/intelligence, que as expõe) — nenhuma tela consulta o
 * banco de tracking diretamente.
 */

export type Period = { from: Date; to: Date };

export function periodFromDays(days: number): Period {
  // "HOJE" é o dia de São Paulo, não as últimas 24h corridas: às 9h da manhã
  // o jeito antigo incluía a noite de ontem inteira e o número nunca batia
  // com o Dashboard (auditoria 06/08/2026). Períodos maiores seguem janela
  // corrida (7/30 dias), igual sempre foram.
  if (days === 1) {
    const diaSP = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
    return { from: new Date(`${diaSP}T03:00:00Z`), to: new Date() };
  }
  return {
    from: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    to: new Date(),
  };
}

export function previousPeriod(p: Period): Period {
  const len = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - len), to: p.from };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

/**
 * CARRINHOS ABANDONADOS — a régua única (KPI e lista de recuperação).
 *
 * Auditoria 06/08/2026: o cartão contava POR SESSÃO (a mesma cliente que
 * voltou no dia seguinte contava 2× e a sacola somava em dobro) enquanto a
 * lista logo abaixo deduplicava por visitante — "2 carrinhos / R$ 1.050" em
 * cima e 1 oportunidade de R$ 550 embaixo. Regra única: 1 visitante = 1
 * carrinho (a sessão mais RECENTE dele), e só sacola com valor (> 0).
 */
export function carrinhosAbandonados<
  S extends { visitorId: string; converted: boolean; cartAdds: number; cartValue: number; startedAt: Date },
>(sessions: S[]): S[] {
  const vistos = new Set<string>();
  const out: S[] = [];
  for (const s of [...sessions].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  )) {
    if (!s.converted && s.cartAdds > 0 && s.cartValue > 0 && !vistos.has(s.visitorId)) {
      vistos.add(s.visitorId);
      out.push(s);
    }
  }
  return out;
}

/**
 * FATURAMENTO REAL por sessão: soma `netTotal` dos pedidos PAGOS ligados às
 * sessões (Order.trackSessionId). Antes o ranking somava `cartValue` — o
 * valor da SACOLA no envio, vindo do navegador, de pedido nem pago — e
 * chamava de faturamento (auditoria 06/08/2026).
 */
async function faturamentoPagoPorSessao(
  companyId: string,
  sessionIds: string[]
): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  const pagos = await db.order.findMany({
    where: {
      companyId,
      trackSessionId: { in: sessionIds },
      status: { in: PAID_ORDER_STATUSES },
    },
    select: { trackSessionId: true, netTotal: true },
  });
  const porSessao = new Map<string, number>();
  for (const o of pagos) {
    if (!o.trackSessionId) continue;
    porSessao.set(o.trackSessionId, (porSessao.get(o.trackSessionId) ?? 0) + o.netTotal);
  }
  return porSessao;
}

async function loadSessions(companyId: string, p: Period) {
  return db.trackSession.findMany({
    where: { companyId, startedAt: { gte: p.from, lte: p.to } },
  });
}

async function loadEvents(companyId: string, p: Period) {
  return db.trackEvent.findMany({
    where: { companyId, createdAt: { gte: p.from, lte: p.to } },
  });
}

// ---- Visão geral ------------------------------------------------------------

export async function overview(companyId: string, p: Period) {
  // Venda = pedido PAGO (fonte única, cobre Nuvemshop e integrações — o
  // modelo Sale só nasce no fluxo manual e subcontava as vendas integradas)
  const [sessions, sales, newCustomers] = await Promise.all([
    loadSessions(companyId, p),
    db.order.findMany({
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: p.from, lte: p.to },
      },
      select: { netTotal: true },
    }),
    db.customer.count({
      where: { companyId, createdAt: { gte: p.from, lte: p.to } },
    }),
  ]);

  const visitors = new Set(sessions.map((s) => s.visitorId));
  const identified = new Set(
    sessions.filter((s) => s.customerId).map((s) => s.customerId)
  );
  const durations = sessions
    .map((s) => (s.lastEventAt.getTime() - s.startedAt.getTime()) / 1000)
    .filter((d) => d >= 0);
  // soma REAL (o "tempo total" era reconstruído por média×sessões, com erro)
  const totalSessionSeconds = Math.round(durations.reduce((a, b) => a + b, 0));
  const converted = sessions.filter((s) => s.converted);
  // mesma régua da lista de recuperação: 1 visitante = 1 carrinho, com valor
  const abandoned = carrinhosAbandonados(sessions);
  const revenue = sales.reduce((a, s) => a + s.netTotal, 0);
  const buyers = await db.order.groupBy({
    by: ["customerId"],
    where: {
      companyId,
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { gte: p.from, lte: p.to },
    },
    _count: true,
  });

  return {
    sessions: sessions.length,
    visitors: visitors.size,
    uniqueVisitors: visitors.size,
    identifiedCustomers: identified.size,
    avgSessionSeconds: durations.length
      ? Math.round(totalSessionSeconds / durations.length)
      : 0,
    totalSessionSeconds,
    ordersFromCatalog: converted.length,
    conversionRate: r2(pct(converted.length, sessions.length)),
    abandonedCarts: abandoned.length,
    abandonedValue: r2(abandoned.reduce((a, s) => a + s.cartValue, 0)),
    revenue: r2(revenue),
    salesCount: sales.length,
    avgTicket: sales.length ? r2(revenue / sales.length) : 0,
    newCustomers,
    returningBuyers: buyers.filter((b) => b._count >= 2).length,
  };
}

// ---- Funil comercial --------------------------------------------------------

export async function funnel(companyId: string, p: Period) {
  const [sessions, events, leads, sales, rebuyers] = await Promise.all([
    loadSessions(companyId, p),
    loadEvents(companyId, p),
    db.customer.count({
      where: { companyId, createdAt: { gte: p.from, lte: p.to } },
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: p.from, lte: p.to },
      },
      _count: true,
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: p.from, lte: p.to },
      },
      _count: true,
      having: { customerId: { _count: { gte: 2 } } },
    }),
  ]);
  const withProduct = new Set(
    events.filter((e) => e.type === "product_view").map((e) => e.sessionId)
  );
  const withAdd = new Set(
    events.filter((e) => e.type === "cart_add").map((e) => e.sessionId)
  );
  const withCart = new Set(
    events.filter((e) => e.type === "cart_open").map((e) => e.sessionId)
  );
  // DUAS POPULAÇÕES, ditas com todas as letras: os 5 primeiros degraus são
  // SÓ do catálogo (sessões rastreadas); os 3 finais são da LOJA INTEIRA
  // (WhatsApp, Nuvemshop, manual). Sem o rótulo, o funil "subia" no meio e
  // parecia bug (40 visitas → 60 leads) — auditoria 06/08/2026.
  return [
    { label: "Visitas (catálogo)", value: sessions.length },
    { label: "Viram produtos", value: withProduct.size },
    { label: "Adicionaram à sacola", value: withAdd.size },
    { label: "Abriram o carrinho", value: withCart.size },
    { label: "Enviaram pedido", value: sessions.filter((s) => s.converted).length },
    { label: "Leads novos (loja inteira)", value: leads },
    { label: "Compraram (loja inteira)", value: sales.length },
    { label: "Recompraram (loja inteira)", value: rebuyers.length },
  ];
}

// ---- Rankings ---------------------------------------------------------------

export async function channelRanking(companyId: string, p: Period) {
  const sessions = await loadSessions(companyId, p);
  // faturamento REAL: pedidos pagos ligados às sessões (não valor de sacola)
  const pagoPorSessao = await faturamentoPagoPorSessao(
    companyId,
    sessions.map((s) => s.id)
  );
  const map = new Map<
    string,
    { channel: string; sessions: number; orders: number; revenue: number }
  >();
  for (const s of sessions) {
    const row =
      map.get(s.channel) ??
      { channel: s.channel, sessions: 0, orders: 0, revenue: 0 };
    row.sessions += 1;
    if (s.converted) row.orders += 1;
    row.revenue += pagoPorSessao.get(s.id) ?? 0;
    map.set(s.channel, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, revenue: r2(r.revenue), conversion: r2(pct(r.orders, r.sessions)) }))
    .sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);
}

export async function sellerRanking(companyId: string, p: Period) {
  const [sessions, sellers, sales, customers] = await Promise.all([
    loadSessions(companyId, p),
    // inclui desligados: o que eles venderam no período continua sendo
    // resultado do período (o filtro final já esconde quem não teve nada)
    db.user.findMany({ where: { companyId } }),
    db.order.findMany({
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: p.from, lte: p.to },
      },
      select: { netTotal: true, sellerId: true },
    }),
    db.customer.findMany({
      where: { companyId },
      include: {
        orders: {
          where: { status: { in: PAID_ORDER_STATUSES }, paidAt: { not: null } },
          orderBy: { paidAt: "asc" },
          take: 1,
          select: { paidAt: true },
        },
      },
    }),
  ]);
  return sellers
    .map((u) => {
      const clicks = sessions.filter((s) => s.sellerId === u.id);
      const orders = clicks.filter((s) => s.converted);
      const mySales = sales.filter((s) => s.sellerId === u.id);
      const revenue = mySales.reduce((a, s) => a + s.netTotal, 0);
      // "dias até a venda" respeita o PERÍODO do relatório: só clientes cuja
      // 1ª compra aconteceu dentro dele (antes olhava a carteira inteira,
      // de qualquer época, dentro de um ranking filtrado por período)
      const daysToSale = customers
        .filter(
          (c) =>
            c.ownerId === u.id &&
            c.orders[0] &&
            c.orders[0].paidAt! >= p.from &&
            c.orders[0].paidAt! <= p.to
        )
        .map(
          (c) =>
            (c.orders[0].paidAt!.getTime() - c.createdAt.getTime()) /
            (24 * 60 * 60 * 1000)
        );
      return {
        id: u.id,
        name: u.name,
        color: u.color,
        clicks: clicks.length,
        orders: orders.length,
        conversion: r2(pct(orders.length, clicks.length)),
        salesCount: mySales.length,
        revenue: r2(revenue),
        avgTicket: mySales.length ? r2(revenue / mySales.length) : 0,
        avgDaysToSale: daysToSale.length
          ? r2(daysToSale.reduce((a, b) => a + b, 0) / daysToSale.length)
          : null,
      };
    })
    .filter((r) => r.clicks > 0 || r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

export async function campaignRanking(companyId: string, p: Period) {
  const [campaigns, sessions, users] = await Promise.all([
    db.trackCampaign.findMany({ where: { companyId } }),
    loadSessions(companyId, p),
    db.user.findMany({ where: { companyId } }),
  ]);
  // faturamento REAL: pedidos pagos ligados às sessões (não valor de sacola)
  const pagoPorSessao = await faturamentoPagoPorSessao(
    companyId,
    sessions.map((s) => s.id)
  );
  return campaigns
    .map((c) => {
      const mine = sessions.filter((s) => s.campaignId === c.id);
      const orders = mine.filter((s) => s.converted);
      const revenue = mine.reduce((a, s) => a + (pagoPorSessao.get(s.id) ?? 0), 0);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        channel: c.channel,
        active: c.active,
        ownerName: users.find((u) => u.id === c.ownerId)?.name ?? null,
        goal: c.goal,
        clicks: mine.length,
        orders: orders.length,
        conversion: r2(pct(orders.length, mine.length)),
        revenue: r2(revenue),
        roi: c.goal > 0 ? r2(pct(revenue, c.goal)) : null, // % da meta
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks);
}

// ---- Produtos / categorias / cores / tamanhos --------------------------------

type Dim = "productName" | "category" | "color" | "size";

async function dimensionStats(companyId: string, p: Period, dim: Dim) {
  const events = await loadEvents(companyId, p);
  const orderItems = await db.orderItem.findMany({
    where: {
      // conta só VENDA DE VERDADE (paga): fora orçamento, aguardando e cancelado
      order: { companyId, paidAt: { gte: p.from, lte: p.to }, status: { in: PAID_ORDER_STATUSES } },
    },
  });
  const map = new Map<
    string,
    { key: string; views: number; adds: number; removes: number; sold: number; revenue: number }
  >();
  const bump = (
    key: string | null | undefined,
    field: "views" | "adds" | "removes" | "sold",
    n = 1,
    revenue = 0
  ) => {
    if (!key) return;
    const row =
      map.get(key) ?? { key, views: 0, adds: 0, removes: 0, sold: 0, revenue: 0 };
    row[field] += n;
    row.revenue += revenue;
    map.set(key, row);
  };
  for (const e of events) {
    const key = e[dim];
    if (e.type === "product_view" || e.type === "category_view" || e.type === "color_select" || e.type === "size_select") {
      if (
        (dim === "productName" && e.type === "product_view") ||
        (dim === "category" && (e.type === "category_view" || e.type === "product_view")) ||
        (dim === "color" && (e.type === "color_select" || e.type === "product_view")) ||
        (dim === "size" && e.type === "size_select")
      ) {
        bump(key, "views");
      }
    }
    if (e.type === "cart_add") bump(key, "adds", e.qty ?? 1);
    if (e.type === "cart_remove") bump(key, "removes", e.qty ?? 1);
  }
  for (const item of orderItems) {
    const key =
      dim === "productName"
        ? item.name
        : dim === "category"
          ? null // categoria não está no snapshot do item
          : dim === "color"
            ? item.color
            : item.size;
    bump(key, "sold", item.quantity, item.total);
  }
  // categorias vendidas via produto → categoria atual
  if (dim === "category") {
    const products = await db.product.findMany({
      where: { companyId },
      select: { name: true, category: true },
    });
    const catByName = new Map(products.map((pr) => [pr.name, pr.category]));
    for (const item of orderItems) {
      bump(catByName.get(item.name), "sold", item.quantity, item.total);
    }
  }
  return [...map.values()].map((row) => ({
    ...row,
    revenue: r2(row.revenue),
    // conversão de funil (viu → colocou na sacola), limitada a 100%.
    // Antes usava peças vendidas/visualizações, o que passava de 100%.
    conversion: r2(Math.min(100, pct(row.adds, Math.max(row.views, 1)))),
    abandonRate: r2(pct(row.removes, Math.max(row.adds, 1))),
  }));
}

export const productStats = (c: string, p: Period) => dimensionStats(c, p, "productName");
export const categoryStats = (c: string, p: Period) => dimensionStats(c, p, "category");
export const colorStats = (c: string, p: Period) => dimensionStats(c, p, "color");
export const sizeStats = (c: string, p: Period) => dimensionStats(c, p, "size");

// ---- Heatmaps (dia da semana × hora) -----------------------------------------

export async function heatmaps(companyId: string, p: Period) {
  const [sessions, sales] = await Promise.all([
    loadSessions(companyId, p),
    db.order.findMany({
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: p.from, lte: p.to },
      },
      select: { netTotal: true, paidAt: true },
    }),
  ]);
  const grid = () => Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  const access = grid();
  const orders = grid();
  const revenue = grid();
  // dia/hora no fuso de São Paulo (UTC-3, sem horário de verão): em UTC o
  // heatmap sairia deslocado 3h e viraria o dia à meia-noite errada
  const sp = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000);
  for (const s of sessions) {
    access[sp(s.startedAt).getUTCDay()][sp(s.startedAt).getUTCHours()] += 1;
    if (s.converted) orders[sp(s.startedAt).getUTCDay()][sp(s.startedAt).getUTCHours()] += 1;
  }
  for (const s of sales) {
    if (!s.paidAt) continue; // pago sem data não entra (não inventa hora)
    revenue[sp(s.paidAt).getUTCDay()][sp(s.paidAt).getUTCHours()] += s.netTotal;
  }
  const conversion = grid();
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      conversion[d][h] = r2(pct(orders[d][h], Math.max(access[d][h], 1)));
    }
  }
  return { access, orders, revenue, conversion };
}

// ---- Recuperação comercial + alertas -----------------------------------------

/**
 * OPORTUNIDADES DE RECUPERAÇÃO — carrinho abandonado, quase comprando, cliente
 * que voltou.
 *
 * Devolve TODAS as oportunidades do período (quem chama decide quantas
 * mostrar). Antes cortava em 12 aqui dentro: a tela dizia "33 carrinhos
 * abandonados" e não existia jeito de ver os outros 21 — dinheiro parado que
 * a loja nunca chegava a perseguir.
 *
 * O teto alto (`LIMITE_RECUPERACAO`) é só para a página não travar num
 * período de um ano numa loja grande.
 */
export const LIMITE_RECUPERACAO = 300;

export async function recovery(companyId: string, p: Period) {
  const sessions = await db.trackSession.findMany({
    where: { companyId, startedAt: { gte: p.from, lte: p.to } },
    include: { visitor: true },
    orderBy: { startedAt: "desc" },
  });
  const customers = await db.customer.findMany({ where: { companyId } });
  const byId = new Map(customers.map((c) => [c.id, c]));

  // AS SACOLAS EM UMA CONSULTA SÓ. Antes era uma consulta por carrinho, dentro
  // do laço: com 12 itens passava, com 300 derrubaria a tela.
  const idsAbandonados = new Set<string>();
  const vistosNaVarredura = new Set<string>();
  for (const s of sessions) {
    if (!s.converted && s.cartAdds > 0 && s.cartValue > 0 && !vistosNaVarredura.has(s.visitorId)) {
      vistosNaVarredura.add(s.visitorId);
      idsAbandonados.add(s.id);
    }
  }
  const eventosDasSacolas = idsAbandonados.size
    ? await db.trackEvent.findMany({
        where: {
          sessionId: { in: [...idsAbandonados] },
          type: { in: ["cart_add", "cart_remove"] },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const eventosPorSessao = new Map<string, typeof eventosDasSacolas>();
  for (const e of eventosDasSacolas) {
    if (!e.sessionId) continue;
    const lista = eventosPorSessao.get(e.sessionId) ?? [];
    lista.push(e);
    eventosPorSessao.set(e.sessionId, lista);
  }
  const out: {
    kind: string;
    title: string;
    detail: string;
    customerId?: string;
    customerPhone?: string;
    items?: string[];
    value?: number;
  }[] = [];

  const seen = new Set<string>();
  for (const s of sessions) {
    if (!s.converted && s.cartAdds > 0 && s.cartValue > 0 && !seen.has(`ab:${s.visitorId}`)) {
      seen.add(`ab:${s.visitorId}`);
      const customer = s.customerId ? byId.get(s.customerId) : null;
      const name = customer?.name ?? null;
      // reconstrói a sacola abandonada pelos eventos (produto/cor/tam/qtd)
      const evs = eventosPorSessao.get(s.id) ?? [];
      const bag = new Map<string, number>();
      for (const e of evs) {
        const key = [e.productName, e.color, e.size].filter(Boolean).join(" · ");
        if (!key) continue;
        const q = e.qty ?? 1;
        bag.set(key, (bag.get(key) ?? 0) + (e.type === "cart_add" ? q : -q));
      }
      const items = [...bag.entries()]
        .filter(([, q]) => q > 0)
        .map(([k, q]) => `${q}× ${k}`);
      out.push({
        kind: "carrinho-abandonado",
        title: `${name ?? "Visitante"} abandonou ${fmtBrl(s.cartValue)} na sacola`,
        detail: `Sessão de ${s.startedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} via ${s.channel}. Recupere com uma mensagem.`,
        customerId: s.customerId ?? undefined,
        customerPhone: customer?.phone || undefined,
        items: items.length ? items : undefined,
        value: s.cartValue,
      });
    }
    if (
      !s.converted && s.productsViewed >= 3 && s.cartAdds === 0 &&
      !seen.has(`quase:${s.visitorId}`)
    ) {
      seen.add(`quase:${s.visitorId}`);
      const name = s.customerId ? byId.get(s.customerId)?.name : null;
      out.push({
        kind: "quase-comprando",
        title: `${name ?? "Visitante"} viu ${s.productsViewed} produtos e não decidiu`,
        detail: `Cliente quente navegando via ${s.channel}. Um empurrãozinho fecha a venda.`,
        customerId: s.customerId ?? undefined,
      });
    }
  }

  // cliente voltou após 30+ dias
  const visitors = await db.visitor.findMany({
    where: { companyId, customerId: { not: null }, lastSeenAt: { gte: p.from } },
  });
  for (const v of visitors) {
    const gap = (v.lastSeenAt.getTime() - v.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000);
    if (v.visits >= 2 && gap >= 30) {
      const c = byId.get(v.customerId!);
      if (c) {
        out.push({
          kind: "cliente-voltou",
          title: `${c.name} voltou ao catálogo depois de um tempo`,
          detail: `${v.visits} visitas no total. Ótimo momento para retomar a conversa.`,
          customerId: c.id,
        });
      }
    }
  }
  return out.slice(0, LIMITE_RECUPERACAO);
}

const fmtBrl = (v: number) =>
  "R$ " + v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export async function alerts(companyId: string, p: Period) {
  const out: string[] = [];
  const [sessions, prodStats, colStats] = await Promise.all([
    db.trackSession.findMany({
      where: { companyId, startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      include: { visitor: true },
    }),
    productStats(companyId, p),
    colorStats(companyId, p),
  ]);
  const customers = await db.customer.findMany({ where: { companyId } });
  const byId = new Map(customers.map((c) => [c.id, c]));

  // visitas repetidas hoje
  const visitsToday = new Map<string, number>();
  for (const s of sessions) {
    visitsToday.set(s.visitorId, (visitsToday.get(s.visitorId) ?? 0) + 1);
  }
  for (const [visitorId, n] of visitsToday) {
    if (n >= 3) {
      const s = sessions.find((x) => x.visitorId === visitorId);
      const name = s?.customerId ? byId.get(s.customerId)?.name : "Um visitante";
      out.push(`${name ?? "Um visitante"} visitou o catálogo ${n} vezes hoje.`);
    }
  }
  // carrinho alto hoje
  for (const s of sessions) {
    if (s.cartValue >= 800) {
      const name = s.customerId ? byId.get(s.customerId)?.name : "Um visitante";
      out.push(`${name ?? "Um visitante"} adicionou ${fmtBrl(s.cartValue)} ao carrinho.`);
    }
  }
  // muito visto, pouco vendido
  for (const pr of prodStats) {
    if (pr.views >= 8 && pr.sold === 0) {
      out.push(`"${pr.key}" está sendo muito visualizado (${pr.views}×) e ainda não vendeu. Revise preço ou foto.`);
    }
  }
  // cor convertendo bem
  for (const c of colStats) {
    if (c.views >= 5 && c.conversion >= 30) {
      out.push(`Cor ${c.key} está convertendo ${c.conversion.toFixed(0)}%. Considere reforçar o estoque.`);
    }
  }
  return [...new Set(out)].slice(0, 8);
}

// ---- Jornada de um cliente ----------------------------------------------------

export async function customerJourney(companyId: string, customerId: string) {
  const visitor = await db.visitor.findFirst({
    where: { companyId, customerId },
  });
  if (!visitor) return null;
  const sessions = await db.trackSession.findMany({
    where: { visitorId: visitor.id },
    orderBy: { startedAt: "desc" },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  const all = sessions.flatMap((s) => s.events);
  const count = (t: string) => all.filter((e) => e.type === t).length;

  // duração de cada sessão (últim. evento − início), em segundos
  const sessionSeconds = (s: (typeof sessions)[number]) =>
    Math.max(0, Math.round((s.lastEventAt.getTime() - s.startedAt.getTime()) / 1000));
  const totalSeconds = sessions.reduce((a, s) => a + sessionSeconds(s), 0);

  // peças que colocou / tirou da sacola (agregadas por produto · cor · tam)
  const addBag = new Map<string, number>();
  const remBag = new Map<string, number>();
  for (const e of all) {
    const key = [e.productName, e.color, e.size].filter(Boolean).join(" · ");
    if (!key) continue;
    if (e.type === "cart_add") addBag.set(key, (addBag.get(key) ?? 0) + (e.qty ?? 1));
    if (e.type === "cart_remove") remBag.set(key, (remBag.get(key) ?? 0) + (e.qty ?? 1));
  }
  const addedItems = [...addBag.entries()].map(([label, qty]) => ({ label, qty }));
  const removedItems = [...remBag.entries()].map(([label, qty]) => ({ label, qty }));

  // produtos que abriu (distintos), do mais visto ao menos
  const viewBag = new Map<string, number>();
  for (const e of all) {
    if (e.type === "product_view" && e.productName) {
      viewBag.set(e.productName, (viewBag.get(e.productName) ?? 0) + 1);
    }
  }
  const viewedProducts = [...viewBag.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, times]) => ({ name, times }));

  const stepOf = (e: (typeof all)[number]) => ({
    type: e.type,
    productName: e.productName,
    category: e.category,
    color: e.color,
    size: e.size,
  });

  return {
    firstVisit: visitor.firstSeenAt,
    lastVisit: visitor.lastSeenAt,
    visits: visitor.visits,
    productsViewed: count("product_view"),
    favorites: count("favorite"),
    added: count("cart_add"),
    removed: count("cart_remove"),
    totalSeconds,
    abandonedCarts: sessions.filter((s) => !s.converted && s.cartAdds > 0).length,
    ordersSubmitted: sessions.filter((s) => s.converted).length,
    channels: [...new Set(sessions.map((s) => s.channel))],
    addedItems,
    removedItems,
    viewedProducts,
    // todas as visitas (passo a passo), da mais recente à mais antiga
    sessions: sessions.slice(0, 10).map((s) => ({
      startedAt: s.startedAt,
      channel: s.channel,
      device: s.device,
      seconds: sessionSeconds(s),
      converted: s.converted,
      cartValue: s.cartValue,
      steps: s.events.slice(0, 40).map(stepOf),
    })),
    lastSession: sessions[0]
      ? {
          startedAt: sessions[0].startedAt,
          channel: sessions[0].channel,
          steps: sessions[0].events.slice(0, 30).map((e) => ({
            type: e.type,
            productName: e.productName,
            category: e.category,
            color: e.color,
            size: e.size,
            value: e.value,
            at: e.createdAt,
          })),
        }
      : null,
  };
}
