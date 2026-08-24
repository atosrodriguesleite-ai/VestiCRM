import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import { sacolaDaFoto, sacolaDosEventos } from "../recuperacao";

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
 *
 * Auditoria 24/08/2026: "abandonou" não pode incluir quem JÁ COMPROU. A
 * sessão em si não converteu, mas a cliente voltou no dia seguinte e enviou o
 * pedido (outra sessão), ou fechou pelo WhatsApp (pedido PAGO sem sessão
 * nenhuma) — e a lista mandava a loja cobrar uma sacola já vendida. Mensagem
 * de "você esqueceu suas peças" para quem acabou de pagar queima a confiança.
 * A sacola só é abandono se NADA depois dela resolveu: nem conversão do
 * mesmo visitante, nem pedido pago da cliente identificada. Compra ANTERIOR
 * à sessão não resolve — sacola nova depois de comprar é desejo novo.
 */
export function conversoesPorVisitante(
  sessions: { visitorId: string; converted: boolean; startedAt: Date }[]
): Map<string, Date[]> {
  const map = new Map<string, Date[]>();
  for (const s of sessions) {
    if (!s.converted) continue;
    const lista = map.get(s.visitorId) ?? [];
    lista.push(s.startedAt);
    map.set(s.visitorId, lista);
  }
  return map;
}

export function sessaoResolvida(
  s: { visitorId: string; customerId?: string | null; startedAt: Date },
  conversoes: Map<string, Date[]>,
  comprasPagas: Map<string, Date[]>
): boolean {
  const t = s.startedAt.getTime();
  if ((conversoes.get(s.visitorId) ?? []).some((d) => d.getTime() >= t)) return true;
  if (s.customerId && (comprasPagas.get(s.customerId) ?? []).some((d) => d.getTime() >= t))
    return true;
  return false;
}

export function carrinhosAbandonados<
  S extends {
    visitorId: string;
    customerId?: string | null;
    converted: boolean;
    cartAdds: number;
    cartValue: number;
    startedAt: Date;
  },
>(
  sessions: S[],
  comprasPagas: Map<string, Date[]> = new Map(),
  // conversões vindas do banco SEM o teto do período: olhando "julho
  // fechado", a visitante anônima que abandonou dia 30/07 e enviou o pedido
  // dia 02/08 já decidiu — só as sessões do período não enxergam isso
  conversoes: Map<string, Date[]> = conversoesPorVisitante(sessions)
): S[] {
  const vistos = new Set<string>();
  const out: S[] = [];
  for (const s of [...sessions].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  )) {
    if (
      !s.converted &&
      s.cartAdds > 0 &&
      s.cartValue > 0 &&
      !sessaoResolvida(s, conversoes, comprasPagas) &&
      !vistos.has(s.visitorId)
    ) {
      vistos.add(s.visitorId);
      out.push(s);
    }
  }
  return out;
}

/**
 * Datas dos pedidos PAGOS das clientes identificadas nas sessões — é o que
 * deixa a régua acima enxergar a compra que aconteceu FORA do catálogo
 * (WhatsApp, pedido manual, Nuvemshop). Só a partir de `desde` (o começo do
 * período): compra mais antiga que qualquer sessão não resolve nenhuma.
 */
export async function comprasPagasDosClientes(
  companyId: string,
  customerIds: (string | null)[],
  desde: Date
): Promise<Map<string, Date[]>> {
  const ids = [...new Set(customerIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return new Map();
  const pedidos = await db.order.findMany({
    where: {
      companyId,
      customerId: { in: ids },
      status: { in: PAID_ORDER_STATUSES },
      paidAt: { gte: desde },
    },
    select: { customerId: true, paidAt: true },
  });
  const map = new Map<string, Date[]>();
  for (const o of pedidos) {
    if (!o.customerId || !o.paidAt) continue;
    const lista = map.get(o.customerId) ?? [];
    lista.push(o.paidAt);
    map.set(o.customerId, lista);
  }
  return map;
}

/**
 * Conversões dos visitantes SEM o teto do período (só o piso `desde`): o
 * pedido enviado DEPOIS do recorte também resolve a sacola de dentro dele —
 * sem isso, o relatório de um mês fechado listava como "abandono" a
 * visitante anônima que converteu no dia seguinte ao fim do período.
 */
export async function conversoesDosVisitantes(
  companyId: string,
  visitorIds: string[],
  desde: Date
): Promise<Map<string, Date[]>> {
  const ids = [...new Set(visitorIds)];
  if (ids.length === 0) return new Map();
  const convertidas = await db.trackSession.findMany({
    where: { companyId, visitorId: { in: ids }, converted: true, startedAt: { gte: desde } },
    select: { visitorId: true, startedAt: true },
  });
  return conversoesPorVisitante(
    convertidas.map((s) => ({ ...s, converted: true }))
  );
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
    // ordem estável: sem ela, qual grafia "chega primeiro" no ranking variava
    // entre atualizações da página (ordem física do banco)
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
  // mesma régua da lista de recuperação: 1 visitante = 1 carrinho, com valor,
  // e quem já comprou (aqui, depois do período, ou pelo WhatsApp) não é abandono
  const naoConvertidas = sessions.filter((s) => !s.converted);
  const [comprasPagas, conversoes] = await Promise.all([
    comprasPagasDosClientes(companyId, naoConvertidas.map((s) => s.customerId), p.from),
    conversoesDosVisitantes(companyId, naoConvertidas.map((s) => s.visitorId), p.from),
  ]);
  const abandoned = carrinhosAbandonados(sessions, comprasPagas, conversoes);
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

/**
 * Nomes "iguais" que diferem no invisível — espaço sobrando no fim, acento
 * gravado de outro jeito (ç composto × ç decomposto), caixa diferente —
 * viravam LINHAS DUPLICADAS no ranking: "Regata Alça" aparecia duas vezes na
 * tela Inteligência (relato do dono, 22/08/2026). A identidade da linha é o
 * nome normalizado em minúsculas; o texto EXIBIDO é a primeira forma vista
 * (a grafia do CADASTRO atual
 * vence quando existe; entre nomes só congelados, vale a primeira na ordem
 * estável de leitura).
 */
export const chaveDoNome = (s: string) =>
  s.normalize("NFC").replace(/\s+/g, " ").trim();

type EventoDoRanking = {
  type: string;
  productId?: string | null;
  productName?: string | null;
  category?: string | null;
  color?: string | null;
  size?: string | null;
  qty?: number | null;
};
type ItemDoRanking = {
  productId?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  quantity: number;
  total: number;
};
type ProdutoDoRanking = { id: string; name: string; category: string | null };

/**
 * Monta o ranking de uma dimensão (produto/categoria/cor/tamanho) a partir
 * dos eventos de navegação e dos itens vendidos. Função PURA — os dados
 * entram prontos — para a regra ser testável sem banco.
 *
 * CONVERSÃO compara evento com evento: "de cada 100 aberturas da ficha,
 * quantas viraram uma adição à sacola". Antes comparava PEÇAS na sacola com
 * ABERTURAS — e no atacado uma adição é uma grade de 10+ peças, então tudo
 * que vendia bem estourava e aparecia 100% (relato do dono, 22/08/2026).
 * A coluna "+Sacola" continua em peças (é a informação útil do atacado).
 */
export function montarRanking(
  events: EventoDoRanking[],
  orderItems: ItemDoRanking[],
  products: ProdutoDoRanking[],
  dim: Dim
) {
  const map = new Map<
    string,
    {
      key: string;
      views: number;
      adds: number;
      addEvents: number;
      removes: number;
      sold: number;
      revenue: number;
    }
  >();
  const bump = (
    key: string | null | undefined,
    field: "views" | "adds" | "addEvents" | "removes" | "sold",
    n = 1,
    revenue = 0,
    /** o nome veio do CADASTRO atual? então a grafia dele manda no rótulo */
    doCadastro = false
  ) => {
    if (!key) return;
    const exibir = chaveDoNome(key);
    if (!exibir) return;
    const id = exibir.toLowerCase();
    const row =
      map.get(id) ??
      { key: exibir, views: 0, adds: 0, addEvents: 0, removes: 0, sold: 0, revenue: 0 };
    if (doCadastro) row.key = exibir;
    row[field] += n;
    row.revenue += revenue;
    map.set(id, row);
  };
  // Acesso E venda se amarram ao CADASTRO ATUAL pelo productId: evento e item
  // de pedido guardam o nome/categoria DA ÉPOCA, e quando a lojista renomeia o
  // produto o nome congelado some do cadastro — resolvido só por nome, a venda
  // sumia da tabela (Categorias somava 139 peças enquanto Cores somava 305) e
  // o mesmo produto virava DUAS linhas (uma só com acessos, outra só com
  // vendas — o alerta "muito visto e não vendeu" disparava à toa). O nome
  // congelado fica de plano B para produto apagado, e peça sem cor/tamanho
  // entra como "Sem cor"/"Sem tamanho" — os três quadros contam as MESMAS peças.
  const porId = new Map(products.map((pr) => [pr.id, pr]));
  // nome NÃO é único no cadastro ([companyId, sku] é): com xarás, vence o mais
  // antigo — determinístico, e só usado como plano B quando o id se perdeu.
  // A busca é pelo nome NORMALIZADO: o congelado com espaço a mais ainda acha.
  const porNome = new Map<string, ProdutoDoRanking>();
  for (const pr of products) {
    const k = chaveDoNome(pr.name).toLowerCase();
    if (!porNome.has(k)) porNome.set(k, pr);
  }
  const cadastroAtual = (
    productId: string | null | undefined,
    nomeCongelado: string | null | undefined
  ) =>
    (productId ? porId.get(productId) : undefined) ??
    (nomeCongelado ? porNome.get(chaveDoNome(nomeCongelado).toLowerCase()) : undefined);
  for (const e of events) {
    const cadastroDoEvento =
      dim === "productName" || dim === "category"
        ? cadastroAtual(e.productId, e.productName)
        : undefined;
    const key =
      dim === "productName"
        ? (cadastroDoEvento?.name ?? e.productName)
        : dim === "category"
          ? e.type === "product_view"
            ? // categoria de HOJE do produto visto; produto sumiu → a da época
              (cadastroDoEvento ? cadastroDoEvento.category || null : e.category)
            : e.category
          : e[dim]?.trim() || null;
    if (e.type === "product_view" || e.type === "category_view" || e.type === "color_select" || e.type === "size_select") {
      if (
        (dim === "productName" && e.type === "product_view") ||
        (dim === "category" && (e.type === "category_view" || e.type === "product_view")) ||
        (dim === "color" && (e.type === "color_select" || e.type === "product_view")) ||
        (dim === "size" && e.type === "size_select")
      ) {
        bump(key, "views", 1, 0, Boolean(cadastroDoEvento));
      }
    }
    if (e.type === "cart_add") {
      bump(key, "adds", e.qty ?? 1, 0, Boolean(cadastroDoEvento));
      bump(key, "addEvents"); // a ADIÇÃO em si, não as peças — é o que a conversão usa
    }
    if (e.type === "cart_remove") bump(key, "removes", e.qty ?? 1, 0, Boolean(cadastroDoEvento));
  }
  for (const item of orderItems) {
    const produto = cadastroAtual(item.productId, item.name);
    const key =
      dim === "productName"
        ? (produto?.name ?? item.name)
        : dim === "category"
          ? produto?.category || "Sem categoria"
          : dim === "color"
            ? item.color?.trim() || "Sem cor"
            : item.size?.trim() || "Sem tamanho";
    bump(key, "sold", item.quantity, item.total, Boolean(produto));
  }
  return [...map.values()].map(({ addEvents, ...row }) => ({
    ...row,
    revenue: r2(row.revenue),
    // conversão de funil (abriu a ficha → adicionou à sacola), evento com
    // evento, limitada a 100% por segurança (adição sem abertura no período
    // é raro, mas existe: a ficha foi aberta antes da meia-noite do recorte)
    conversion: r2(Math.min(100, pct(addEvents, Math.max(row.views, 1)))),
    abandonRate: r2(pct(row.removes, Math.max(row.adds, 1))),
  }));
}

/**
 * O que o item VENDEU de verdade: a fatia dele no `netTotal` do pedido.
 *
 * O item guarda `total` = preço × quantidade (nível do subtotal) e não sabe
 * do desconto/acréscimo GLOBAL do pedido (ADR-013). Somar `item.total` fazia
 * as abas Produtos/Categorias/Cores (e o CSV) mostrarem MAIS faturamento que
 * o cartão da Visão Geral, que soma `netTotal` (RN-002) — num pedido de
 * R$ 1.000 com 10% de desconto, as linhas somavam 1.000 e o cartão, 900.
 * O rateio é proporcional: cada item carrega sua fração do desconto e do
 * acréscimo, e a soma das linhas volta a bater com o cartão. (Frete fica
 * fora dos dois lados, como manda a RN-002.)
 */
export function valorVendidoDoItem(
  itemTotal: number,
  orderSubtotal: number,
  orderNetTotal: number
): number {
  if (orderSubtotal <= 0) return itemTotal;
  return (itemTotal * orderNetTotal) / orderSubtotal;
}

async function dimensionStats(companyId: string, p: Period, dim: Dim) {
  const events = await loadEvents(companyId, p);
  const itensCrus = await db.orderItem.findMany({
    where: {
      // conta só VENDA DE VERDADE (paga): fora orçamento, aguardando e cancelado
      order: { companyId, paidAt: { gte: p.from, lte: p.to }, status: { in: PAID_ORDER_STATUSES } },
    },
    include: { order: { select: { subtotal: true, netTotal: true } } },
    orderBy: { id: "asc" }, // mesma razão da ordem estável dos eventos
  });
  const orderItems = itensCrus.map((item) => ({
    ...item,
    total: valorVendidoDoItem(item.total, item.order.subtotal, item.order.netTotal),
  }));
  const precisaCadastro = dim === "productName" || dim === "category";
  const products =
    precisaCadastro && (events.length > 0 || orderItems.length > 0)
      ? await db.product.findMany({
          where: { companyId },
          select: { id: true, name: true, category: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : [];
  return montarRanking(events, orderItems, products, dim);
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
    orderBy: { startedAt: "desc" },
  });
  // só o que a lista usa (nome e telefone) — carregar a ficha inteira de
  // todas as clientes derrubaria a tela numa loja grande
  const customers = await db.customer.findMany({
    where: { companyId },
    select: { id: true, name: true, phone: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  // A MESMA RÉGUA do KPI (carrinhosAbandonados): 1 visitante = 1 carrinho e
  // quem já comprou não é abandono — a lista chegou a mandar a loja cobrar
  // cliente que tinha acabado de pagar pelo WhatsApp (auditoria 24/08/2026).
  const naoConvertidas = sessions.filter((s) => !s.converted);
  const [comprasPagas, conversoes] = await Promise.all([
    comprasPagasDosClientes(companyId, naoConvertidas.map((s) => s.customerId), p.from),
    conversoesDosVisitantes(companyId, naoConvertidas.map((s) => s.visitorId), p.from),
  ]);
  const abandonadas = carrinhosAbandonados(sessions, comprasPagas, conversoes);
  const idsAbandonados = new Set(abandonadas.map((s) => s.id));

  // AS SACOLAS EM UMA CONSULTA SÓ. Antes era uma consulta por carrinho, dentro
  // do laço: com 12 itens passava, com 300 derrubaria a tela.
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
    if (idsAbandonados.has(s.id)) {
      const customer = s.customerId ? byId.get(s.customerId) : null;
      const name = customer?.name ?? null;
      // a sacola como a esteira de Recuperação lê (fonte única em
      // lib/recuperacao.ts): 1º a FOTO gravada no evento (estado real, com
      // quantidade e variante certas); sessão antiga sem foto cai na
      // reconstrução por eventos, com a peneira do tamanho composto ("P,M"
      // é a grade inteira, não uma variante). A remontagem antiga daqui
      // errava quantidade e mostrava sacola diferente da tela Recuperação.
      const evs = eventosPorSessao.get(s.id) ?? [];
      const ultimaFoto = [...evs].reverse().map((e) => sacolaDaFoto(e.meta)).find(Boolean);
      const itensDaSacola =
        ultimaFoto ?? sacolaDosEventos(evs).filter((i) => !i.size?.includes(","));
      const items = itensDaSacola.map((i) =>
        [`${i.qty}× ${i.name}`, i.color, i.size].filter(Boolean).join(" · ")
      );
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
      // quem depois converteu (ou comprou pelo WhatsApp) DECIDIU — o
      // "empurrãozinho" chegaria depois da venda feita
      !sessaoResolvida(s, conversoes, comprasPagas) &&
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
