import { Suspense } from "react";
import Link from "next/link";
import {
  Wallet,
  Users,
  Target,
  TrendingUp,
  Percent,
  AlertTriangle,
  CalendarClock,
  Trophy,
  Shirt,
  ShoppingBag,
  Repeat,
  Package,
  Gem,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { maybeSyncNuvemshop } from "@/lib/nuvemshop";
import { db } from "@/lib/db";
import { ownedScope, taskScope, canSeeAll, isSuperAdmin } from "@/lib/scope";
import {
  brl,
  daysSince,
  dateShort,
  timeShort,
  taskTypeLabel,
  relativeDays,
} from "@/lib/format";
import {
  PAID_ORDER_STATUSES,
  ORDER_STATUS_FLOW,
  orderStatusLabel,
  orderStatusColor,
} from "@/lib/orders";
import { Card, PageHeader, Avatar, PriorityDot, EmptyState } from "@/components/ui";
import { BarList, AreaCompare, Donut, PeriodChips } from "@/components/charts";
import { StatCard } from "@/components/dash";
import { InfoTip } from "@/components/info-tip";
import { PrimeirosPassos, type Passo } from "./primeiros-passos";
import { ChamadasDoDia, ChamadasDoDiaEsqueleto } from "./chamadas-do-dia";
import { computeAutomations } from "@/lib/automations";
import { chaveDoNome } from "@/lib/tracking/insights";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  // loja integrada: busca carrinhos abandonados da Nuvemshop em 2º plano
  maybeSyncNuvemshop(user.companyId);
  const { de, ate } = await searchParams;
  // Super Admin (fora do modo "Acessar loja") gerencia a plataforma, não uma
  // loja: seu ponto de partida é a gestão de clientes (Lojas).
  if (isSuperAdmin(user) && !user.impersonatedBy) redirect("/lojas");
  // Suporte trabalha em Pedidos — dashboard comercial não é dele
  if (user.role === "SUPPORT") redirect("/pedidos");
  const scope = ownedScope(user);
  const now = new Date();
  const days30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const days7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // Período analítico do dashboard (filtro De/Até). Padrão: últimos 30 dias.
  const SP_OFFSET = 3 * 60 * 60 * 1000; // São Paulo é UTC-3
  const spStart = (d?: string) => {
    const t = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
    return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
  };
  const spEnd = (d?: string) => {
    const t = d ? Date.parse(`${d}T23:59:59.999Z`) : NaN;
    return Number.isNaN(t) ? null : new Date(t + SP_OFFSET);
  };
  const from = spStart(de) ?? days30;
  const to = spEnd(ate) ?? now;
  const inPeriod = { gte: from, lte: to };
  const customPeriod = !!(spStart(de) || spEnd(ate));
  // Período ANTERIOR com a mesma duração, imediatamente antes do atual —
  // base das setinhas de variação (% vs período anterior) nos cartões.
  const durMs = Math.max(to.getTime() - from.getTime(), 1);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - durMs);
  const inPrev = { gte: prevFrom, lte: prevTo };
  // meia-noite no fuso de São Paulo (UTC-3): o servidor roda em UTC e o
  // setHours local começaria o "hoje" 3h mais cedo
  const spMidnight = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  spMidnight.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(spMidnight.getTime() + 3 * 60 * 60 * 1000);
  const spMonth = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  spMonth.setUTCDate(1);
  spMonth.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(spMonth.getTime() + 3 * 60 * 60 * 1000);

  const saleScope = canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
  // Faturamento/venda = pedido PAGO (ou além). Pedido gerado sem pagamento
  // não conta como venda — regra central do produto.
  const orderScope = { ...saleScope, status: { in: PAID_ORDER_STATUSES } };
  // pedidos gerados (qualquer status) — denominador da conversão em pagamento
  const orderAnyScope = saleScope;

  // MOTOR DE SUGESTÕES ("quem chamar hoje"): começa AGORA, junto com as
  // consultas abaixo, mas quem espera por ele é o bloco em Suspense lá no
  // fim. É o mais demorado da tela e o único que não depende do filtro de
  // data — assim ele não segura os números do período, e mesmo assim não
  // atrasa: trabalha em paralelo.
  //
  // O `.catch` vazio serve só para o Node não reclamar de "promessa rejeitada
  // sem ninguém olhando" enquanto ninguém deu `await`. O erro continua
  // valendo: ele estoura no `await` de quem realmente usa o resultado.
  const sugestoes = computeAutomations(user);
  sugestoes.catch(() => {});

  // Todas as consultas independentes vão juntas ao banco (uma rodada só) —
  // é o que deixa o dashboard rápido de abrir.
  const [
    sales30,
    totalCustomers,
    newLeads30,
    openOpps,
    stagesFunil,
    lostOpps30,
    noContactCustomers,
    noContactCount,
    nextTasks,
    sellers,
    interests,
    ordersToday,
    ordersWeek,
    topItemsRaw,
    topBuyers,
    buyersAll,
    ordersGenerated30,
    cohortPaid30,
    monthOrders,
    companyCfg,
    prevSales,
    prevLeads,
    prevOrdersGenerated,
    prevCohortPaid,
    statusCounts,
  ] = await Promise.all([
    // Faturamento = pedidos PAGOS (fonte única da verdade, igual à tela Pedidos)
    db.order.findMany({
      where: { ...orderScope, paidAt: inPeriod },
      // VALOR VENDIDO (netTotal): o frete atravessa a loja e vai para a
      // transportadora — não é faturamento nem comissão
      select: { netTotal: true, sellerId: true, paidAt: true },
    }),
    db.customer.count({ where: scope }),
    db.customer.count({ where: { ...scope, createdAt: inPeriod } }),
    db.opportunity.findMany({ where: { ...scope, status: "OPEN" } }),
    // etapas do funil — o "em fechamento" conta pela POSIÇÃO (as 2 últimas
    // antes do ganho), não pelo nome: loja que renomeava as etapas ("Pedido
    // em negociação" → outro nome) travava o contador em zero para sempre
    db.stage.findMany({
      where: { pipeline: { companyId: user.companyId } },
      select: { id: true, pipelineId: true, order: true, isWon: true, isLost: true },
      orderBy: { order: "asc" },
    }),
    db.opportunity.count({
      where: { ...scope, status: "LOST", closedAt: inPeriod },
    }),
    db.customer.findMany({
      where: {
        ...scope,
        OR: [{ lastContactAt: { lt: days7 } }, { lastContactAt: null }],
      },
      orderBy: { lastContactAt: "asc" },
      take: 6,
      include: { owner: true },
    }),
    // contagem REAL dos sem-contato: o cartão mostrava o tamanho da lista
    // acima (take: 6) e travava em "6" mesmo com 40 esfriando
    db.customer.count({
      where: {
        ...scope,
        OR: [{ lastContactAt: { lt: days7 } }, { lastContactAt: null }],
      },
    }),
    db.task.findMany({
      where: { ...taskScope(user), status: "PENDENTE" },
      orderBy: { dueAt: "asc" },
      take: 7,
      include: { customer: true, assignee: true },
    }),
    db.user.findMany({
      where: { companyId: user.companyId, role: { in: ["SELLER", "MANAGER", "ADMIN"] } },
    }),
    db.interest.findMany({
      where: { companyId: user.companyId },
      include: { _count: { select: { customers: true } } },
    }),
    // --- Pedidos (módulo catálogo) ---
    db.order.aggregate({
      where: { ...orderScope, paidAt: { gte: startOfDay } },
      _count: true,
      _sum: { netTotal: true },
    }),
    db.order.aggregate({
      where: { ...orderScope, paidAt: { gte: days7 } },
      _count: true,
      _sum: { netTotal: true },
    }),
    // agrupado pelo PRODUTO (não pelo nome congelado no item): o pedido
    // guarda o nome da época — renomear a peça (ex.: tirar a cor do nome)
    // dividia as vendas em duas linhas e o ranking mentia (12/08/2026).
    // O top 6 é montado depois, com o nome ATUAL do cadastro.
    db.orderItem.groupBy({
      by: ["productId", "name"],
      where: { order: { ...orderScope, paidAt: inPeriod } },
      _sum: { quantity: true },
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: { ...orderScope, paidAt: inPeriod },
      _sum: { netTotal: true },
      _count: true,
      // ordena pelo MESMO campo que soma, senão a lista sai fora de ordem
      orderBy: { _sum: { netTotal: "desc" } },
      take: 5,
    }),
    // taxa de recompra: clientes com 2+ pedidos entre quem já pediu
    db.order.groupBy({
      by: ["customerId"],
      where: orderScope,
      _count: true,
    }),
    db.order.count({ where: { ...orderAnyScope, createdAt: inPeriod } }),
    // conversão por COORTE: dos pedidos CRIADOS no período, quantos já estão
    // pagos. Numerador de paidAt com denominador de createdAt passava de 100%
    // (pedido antigo pago agora contava sem ter sido gerado no período) e o
    // rodapé ficava negativo (auditoria 07/08/2026)
    db.order.count({
      // coorte-ok: conta pedidos por criação de propósito — não soma dinheiro
      where: { ...orderScope, createdAt: inPeriod },
    }),
    // metas: vendas pagas do MÊS CORRENTE (fuso SP), por vendedor
    db.order.findMany({
      where: {
        companyId: user.companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: startOfMonth },
      },
      select: { netTotal: true, sellerId: true },
    }),
    // alerta de estoque: variações no limite configurado pela loja
    db.company.findUniqueOrThrow({
      where: { id: user.companyId },
      select: { lowStockThreshold: true },
    }),
    // --- comparativo: mesmas métricas no período ANTERIOR ---
    db.order.findMany({
      where: { ...orderScope, paidAt: inPrev },
      select: { netTotal: true, paidAt: true },
    }),
    db.customer.count({ where: { ...scope, createdAt: inPrev } }),
    db.order.count({ where: { ...orderAnyScope, createdAt: inPrev } }),
    // coorte do período anterior (mesma régua da conversão atual)
    db.order.count({
      // coorte-ok: conta pedidos por criação de propósito — não soma dinheiro
      where: { ...orderScope, createdAt: inPrev },
    }),
    // donut: composição dos pedidos do período por status (qualquer status)
    db.order.groupBy({
      by: ["status"],
      where: { ...orderAnyScope, createdAt: inPeriod },
      _count: true,
    }),
  ]);

  // PRODUTOS MAIS VENDIDOS com o nome ATUAL do cadastro. Duas fusões:
  //  1) pelo produto — vendas antigas de um produto renomeado somam juntas;
  //  2) pelo nome final — produtos-por-cor que ganharam o MESMO nome (a loja
  //     tirou a cor do nome; a cor mora na variação) viram UMA família.
  // Linha sem produto vinculado (avulsa) agrupa pelo nome gravado no item.
  const somaPorChave = new Map<string, number>();
  const nomeGravado = new Map<string, string>();
  const maiorLinha = new Map<string, number>();
  for (const t of topItemsRaw) {
    const chave = t.productId ?? `nome:${chaveDoNome(t.name)}`;
    somaPorChave.set(chave, (somaPorChave.get(chave) ?? 0) + (t._sum.quantity ?? 0));
    // fallback de produto apagado: vale o nome da linha de MAIOR quantidade
    // (pegar "a última do banco" mudava o rótulo a cada recarregamento)
    if (t.productId && (t._sum.quantity ?? 0) > (maiorLinha.get(t.productId) ?? -1)) {
      maiorLinha.set(t.productId, t._sum.quantity ?? 0);
      nomeGravado.set(t.productId, t.name);
    }
  }
  const idsVendidos = [...somaPorChave.keys()].filter((k) => !k.startsWith("nome:"));

  // SEGUNDA RODADA DE CONSULTAS — velocidade, 20/08/2026.
  //
  // Estas consultas estavam espalhadas pelo resto da função, cada uma
  // esperando a anterior: nomes atuais das peças, nomes das compradoras,
  // tarefas vencidas e peças com estoque baixo. Só as duas primeiras
  // dependiam de algo (do resultado da rodada lá de cima, que já terminou) —
  // as outras não dependiam de nada e mesmo assim ficavam na fila. Agora
  // saem todas juntas. (As fichas de "quem chamar hoje" e os textos das
  // mensagens saíram daqui em 25/08/2026: foram para `chamadas-do-dia.tsx`,
  // que carrega à parte.)
  const [nomesAtuais, buyerNames, overdue, lowStockCount] = await Promise.all([
    idsVendidos.length
      ? db.product.findMany({
          where: { id: { in: idsVendidos } },
          select: { id: true, name: true },
        })
      : [],
    db.customer.findMany({
      where: { id: { in: topBuyers.map((b) => b.customerId) } },
      select: { id: true, name: true },
    }),
    // conta TODAS as pendentes vencidas (antes contava só entre as 7 exibidas
    // na lista — o cartão travava em "7" mesmo com 20 atrasadas)
    db.task.count({
      where: { ...taskScope(user), status: "PENDENTE", dueAt: { lt: now } },
    }),
    db.productVariant.count({
      where: {
        product: { companyId: user.companyId, active: true },
        stock: { lte: companyCfg.lowStockThreshold },
      },
    }),
  ]);
  const nomeAtual = new Map(nomesAtuais.map((p) => [p.id, p.name]));
  // A fusão final usa a chave NORMALIZADA (chaveDoNome: NFC + espaços
  // colapsados + trim, sem maiúscula/minúscula) — nomes que renderizam
  // iguais mas diferem em bytes (ç decomposto do iOS/Nuvemshop, espaço no
  // fim, NBSP) viravam DUAS linhas no cartão: visto em produção com
  // "Regata Alça" duplicada (175 + 20 un.). Mesma régua da Inteligência,
  // que já tinha levado esse conserto.
  const somaPorNome = new Map<string, { rotulo: string; qtd: number; doCadastro: boolean }>();
  for (const [chave, qtd] of somaPorChave) {
    const doCadastro = !chave.startsWith("nome:") && nomeAtual.has(chave);
    const rotulo = chave.startsWith("nome:")
      ? chave.slice(5)
      : // produto apagado do cadastro: vale o nome gravado no pedido
        (nomeAtual.get(chave) ?? nomeGravado.get(chave) ?? "Produto removido");
    const k = chaveDoNome(rotulo).toLowerCase();
    const linha = somaPorNome.get(k) ?? { rotulo: chaveDoNome(rotulo), qtd: 0, doCadastro };
    linha.qtd += qtd;
    // a grafia do CADASTRO vence a do item avulso (mesma regra da
    // Inteligência) — senão o rótulo mudava conforme a ordem do banco
    if (doCadastro && !linha.doCadastro) {
      linha.rotulo = chaveDoNome(rotulo);
      linha.doCadastro = true;
    }
    somaPorNome.set(k, linha);
  }
  const topItems = [...somaPorNome.values()]
    .map(({ rotulo, qtd }) => ({ name: rotulo, quantidade: qtd }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 6);

  const buyerName = new Map(buyerNames.map((b) => [b.id, b.name]));
  const repurchaseRate = buyersAll.length
    ? (buyersAll.filter((b) => b._count >= 2).length / buyersAll.length) * 100
    : 0;

  const revenue30 = sales30.reduce((s, v) => s + v.netTotal, 0);
  const ticket = sales30.length ? revenue30 / sales30.length : 0;
  // Conversão por COORTE: dos pedidos CRIADOS no período, quantos já estão
  // pagos. Nunca passa de 100% (o pago é subconjunto do gerado) e o "sem
  // pagamento" do rodapé nunca fica negativo.
  const conversion = ordersGenerated30
    ? (cohortPaid30 / ordersGenerated30) * 100
    : 0;
  // CANCELADO não é "sem pagamento": o rodapé somava pedido cancelado como
  // cobrança pendente (auditoria 24/08/2026). Usa a mesma contagem por status
  // do donut (pedidos criados no período).
  const canceladosPeriodo =
    statusCounts.find((s) => s.status === "CANCELADO")?._count ?? 0;
  const aguardandoPagamento = Math.max(
    0,
    ordersGenerated30 - cohortPaid30 - canceladosPeriodo
  );
  const pipelineValue = openOpps.reduce((s, o) => s + o.value, 0);
  // "em fechamento" = oportunidades ABERTAS nas 2 últimas etapas antes do
  // ganho de cada funil (no padrão: "Pedido em negociação" e "Pagamento
  // pendente") — pela posição, o contador sobrevive à renomeação das etapas
  const etapasDeFechamento = new Set<string>();
  {
    const porPipeline = new Map<string, typeof stagesFunil>();
    for (const s of stagesFunil) {
      const lista = porPipeline.get(s.pipelineId) ?? [];
      lista.push(s);
      porPipeline.set(s.pipelineId, lista);
    }
    for (const etapas of porPipeline.values()) {
      const ordensGanho = etapas.filter((e) => e.isWon).map((e) => e.order);
      const ordemGanho = ordensGanho.length ? Math.min(...ordensGanho) : Infinity;
      for (const e of etapas
        .filter((x) => !x.isWon && !x.isLost && x.order < ordemGanho)
        .slice(-2)) {
        etapasDeFechamento.add(e.id);
      }
    }
  }
  const negotiatingOpps = openOpps.filter((o) =>
    etapasDeFechamento.has(o.stageId)
  ).length;
  const periodLabel = customPeriod
    ? `${dateShort(from)} a ${dateShort(to)}`
    : "últimos 30 dias";

  // --- séries diárias (fuso SP) + variação % vs período anterior ---
  const DAY = 86_400_000;
  const dayIdx = (d: Date) => Math.floor((d.getTime() - SP_OFFSET) / DAY);
  const firstIdx = dayIdx(from);
  // teto de ~4 anos só para o array não explodir com uma data digitada
  // errada. Antes o teto era 400 dias e o corte era MUDO: filtrando 13+
  // meses, o fim do período sumia do gráfico sem aviso (auditoria
  // 24/08/2026) — agora o teto quase nunca é atingido e, quando é, a tela diz.
  const TETO_DIAS_GRAFICO = 1465;
  const totalDias = Math.max(dayIdx(to) - firstIdx + 1, 1);
  const nDias = Math.min(totalDias, TETO_DIAS_GRAFICO);
  const graficoCortado = totalDias > TETO_DIAS_GRAFICO;
  const serieFat = new Array<number>(nDias).fill(0);
  for (const v of sales30) {
    if (!v.paidAt) continue;
    const i = dayIdx(v.paidAt) - firstIdx;
    if (i >= 0 && i < nDias) serieFat[i] += v.netTotal;
  }
  const prevFirstIdx = dayIdx(prevFrom);
  const seriePrev = new Array<number>(nDias).fill(0);
  for (const v of prevSales) {
    if (!v.paidAt) continue;
    const i = dayIdx(v.paidAt) - prevFirstIdx;
    if (i >= 0 && i < nDias) seriePrev[i] += v.netTotal;
  }
  let labelsDias = Array.from({ length: nDias }, (_, i) => {
    const d = new Date((firstIdx + i) * DAY);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  // período muito longo: agrupa por semana pro gráfico não virar serrote
  const porSemana = (arr: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < arr.length; i += 7)
      out.push(arr.slice(i, i + 7).reduce((a, b) => a + b, 0));
    return out;
  };
  let chartFat = serieFat;
  let chartPrev = seriePrev;
  const agrupadoPorSemana = nDias > 92;
  if (agrupadoPorSemana) {
    chartFat = porSemana(serieFat);
    chartPrev = porSemana(seriePrev);
    labelsDias = labelsDias.filter((_, i) => i % 7 === 0);
  }

  const pctDelta = (cur: number, prev: number) =>
    prev > 0 ? ((cur - prev) / prev) * 100 : null;
  const prevRevenue = prevSales.reduce((s, v) => s + v.netTotal, 0);
  const prevTicket = prevSales.length ? prevRevenue / prevSales.length : 0;
  const prevConversion = prevOrdersGenerated
    ? (prevCohortPaid / prevOrdersGenerated) * 100
    : 0;
  const deltaVendas = pctDelta(revenue30, prevRevenue);
  const deltaTicket = pctDelta(ticket, prevTicket);
  const deltaConv = pctDelta(conversion, prevConversion);
  const deltaLeads = pctDelta(newLeads30, prevLeads);

  // donut de status: na ordem do fluxo do pedido, com as cores oficiais
  const statusCount = new Map(statusCounts.map((s) => [s.status, s._count]));
  const donutStatus = ORDER_STATUS_FLOW.map((st) => ({
    label: orderStatusLabel[st],
    value: statusCount.get(st) ?? 0,
    color: orderStatusColor[st],
  }));
  const totalPedidosPeriodo = statusCounts.reduce((a, s) => a + s._count, 0);

  // ranking por vendedor — gerente/admin vê o time todo (sales30 já é a loja
  // inteira para eles); a VENDEDORA vê só a própria linha. Antes a consulta
  // extra buscava a loja inteira justamente para quem NÃO pode ver o
  // faturamento dos colegas (auditoria 07/08/2026: o código fazia o oposto
  // do comentário).
  const allSales30 = sales30;
  const ranking = sellers
    .map((s) => ({
      seller: s,
      // "totalVendido" de propósito: é soma de netTotal (sem frete) — chamar
      // de "total" confundia com o campo total do pedido, que tem frete
      totalVendido: allSales30
        .filter((v) => v.sellerId === s.id)
        .reduce((sum, v) => sum + v.netTotal, 0),
      count: allSales30.filter((v) => v.sellerId === s.id).length,
    }))
    .filter((r) => r.count > 0);
  // venda SEM dona (Nuvemshop, catálogo sem ?ref=) entra como linha da loja
  // — sem ela o ranking somava MENOS que o cartão de Vendas da mesma tela
  // (mesma queixa que criou a linha nos Relatórios). Para a vendedora nada
  // muda: o escopo dela não tem venda sem dona.
  const semDona = allSales30.filter((v) => !v.sellerId);
  if (semDona.length > 0) {
    ranking.push({
      seller: {
        id: "loja-sem-vendedora",
        name: "Loja (sem vendedora)",
        color: "#94a3b8",
        monthlyGoal: 0,
      } as unknown as (typeof sellers)[number],
      totalVendido: semDona.reduce((sum, v) => sum + v.netTotal, 0),
      count: semDona.length,
    });
  }
  ranking.sort((a, b) => b.totalVendido - a.totalVendido);

  const topInterests = interests
    .map((i) => ({ label: i.name, value: i._count.customers }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // metas: vendido no mês por vendedor + meta própria (quando vendedor)
  const soldBySeller = new Map<string, number>();
  for (const o of monthOrders) {
    if (o.sellerId)
      soldBySeller.set(o.sellerId, (soldBySeller.get(o.sellerId) ?? 0) + o.netTotal);
  }
  const me = sellers.find((s) => s.id === user.id);
  const myGoal = me?.monthlyGoal ?? 0;
  const mySold = soldBySeller.get(user.id) ?? 0;

  // Checklist "Primeiros passos" — só para quem configura a loja (a vendedora
  // não mexe em catálogo nem em conexão de WhatsApp). Lista vazia = card não
  // aparece; loja que completou os 4 passos também deixa de ver.
  let passos: Passo[] = [];
  if (canSeeAll(user)) {
    const [comm, produtosCount, pedidosCount, identidade] = await Promise.all([
      db.commSettings.findUnique({
        where: { companyId: user.companyId },
        select: { evolutionStatus: true },
      }),
      db.product.count({ where: { companyId: user.companyId } }),
      db.order.count({ where: { companyId: user.companyId } }),
      db.company.findUnique({
        where: { id: user.companyId },
        select: { logoUrl: true },
      }),
    ]);
    passos = [
      {
        done: comm?.evolutionStatus === "CONECTADO",
        label: "Conectar o WhatsApp da loja",
        hint: "É por onde a maior parte das vendas acontece.",
        href: "/comunicacao",
      },
      {
        done: produtosCount > 0,
        label: "Cadastrar o primeiro produto",
        hint: "Sem produto, o catálogo fica vazio.",
        href: "/produtos",
      },
      {
        done: Boolean(identidade?.logoUrl),
        label: "Colocar sua logo no catálogo",
        hint: "O catálogo passa a ter a cara da sua marca.",
        href: "/configuracoes/catalogo",
      },
      {
        done: pedidosCount > 0,
        label: "Receber o primeiro pedido",
        hint: "Compartilhe o link do catálogo com suas clientes.",
        href: "/configuracoes/catalogo",
      },
    ];
  }

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title={`Olá, ${user.name.split(" ")[0]} 👋`}
        subtitle={`Visão geral do comercial — ${periodLabel}.`}
      />

      <div className="mb-5 -mt-1">
        <PeriodChips pathname="/dashboard" de={de} ate={ate} />
      </div>

      {/* carrega à parte: é o bloco mais pesado e o único que NÃO depende do
          filtro de data — segurando a tela inteira, cada troca de período
          esperava por ele antes de desenhar qualquer coisa */}
      <Suspense fallback={<ChamadasDoDiaEsqueleto />}>
        <ChamadasDoDia
          user={user}
          primeiroNome={user.name.split(" ")[0]}
          sugestoes={sugestoes}
        />
      </Suspense>

      <PrimeirosPassos passos={passos} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard
          label={customPeriod ? "Vendas (período)" : "Vendas (30d)"}
          value={revenue30}
          format="brl"
          delta={deltaVendas}
          series={chartFat}
          hint={`${sales30.length} pedidos${customPeriod ? " no período" : ""}`}
          icon={<Wallet />}
          info="Soma do valor de todos os pedidos PAGOS no período. Pedido gerado sem pagamento não entra aqui. A setinha compara com o período anterior de mesma duração."
        />
        <StatCard
          label="Ticket médio"
          value={ticket}
          format="brl"
          delta={deltaTicket}
          icon={<TrendingUp />}
          info="Valor médio por pedido pago: total vendido ÷ número de pedidos pagos no período. A setinha compara com o período anterior."
        />
        <StatCard
          label="Taxa de conversão"
          value={conversion}
          format="pct"
          delta={deltaConv}
          hint={`${cohortPaid30} pagos · ${aguardandoPagamento} sem pagamento${canceladosPeriodo > 0 ? ` · ${canceladosPeriodo} cancelados` : ""}`}
          icon={<Percent />}
          tone={conversion >= 50 ? "good" : "warn"}
          info="Dos pedidos CRIADOS no período, quantos já foram pagos. Pedido antigo pago agora não entra — por isso a taxa nunca passa de 100%. Cancelados aparecem à parte: não são cobrança pendente."
        />
        <StatCard
          label="Funil aberto"
          value={pipelineValue}
          format="brl"
          hint={`${openOpps.length} oportunidades · ${negotiatingOpps} em fechamento`}
          icon={<Target />}
          info="Soma do valor das oportunidades ainda abertas no funil. É potencial de venda, não é faturamento."
        />
        <StatCard
          label="Clientes"
          value={totalCustomers}
          hint={`+${newLeads30} novos leads${customPeriod ? " no período" : " em 30d"}`}
          delta={deltaLeads}
          deltaHint="novos leads vs. período anterior"
          icon={<Users />}
          info="Total de clientes cadastrados na loja. O rodapé mostra quantos entraram no período — é essa entrada de leads que a setinha compara com o período anterior."
        />
        <StatCard
          label={customPeriod ? "Vendas perdidas (período)" : "Vendas perdidas (30d)"}
          value={lostOpps30}
          icon={<AlertTriangle />}
          tone={lostOpps30 > 3 ? "bad" : "default"}
          info="Oportunidades movidas para uma etapa de perda no funil dentro do período."
        />
        <StatCard
          label="Sem contato há 7+ dias"
          value={noContactCount}
          hint="clientes esfriando"
          icon={<CalendarClock />}
          tone={noContactCount > 0 ? "warn" : "good"}
          info="Clientes sem nenhum contato registrado nos últimos 7 dias (ou que nunca foram contatados)."
        />
        <StatCard
          label="Follow-ups atrasados"
          value={overdue}
          icon={<AlertTriangle />}
          tone={overdue > 0 ? "bad" : "good"}
          info="Tarefas de acompanhamento cuja data de vencimento já passou e continuam pendentes."
        />
        {myGoal > 0 && (
          <StatCard
            label="Minha meta do mês"
            value={Math.round((mySold / myGoal) * 100)}
            format="pct"
            hint={`${brl(mySold)} de ${brl(myGoal)}`}
            icon={<Target />}
            tone={mySold >= myGoal ? "good" : "default"}
            info="Quanto das suas vendas pagas do mês corrente já cobre a meta definida em Equipe."
          />
        )}
      </div>

      {/* Faturamento diário × período anterior + composição por status */}
      {(sales30.length > 0 || prevSales.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
          <Card className="p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <h2 className="font-semibold flex items-center gap-2 text-sm">
                <TrendingUp className="size-4 text-brand-600" />
                Faturamento no período
                {agrupadoPorSemana && (
                  <span className="text-[11px] font-normal text-slate-400">
                    · por semana
                  </span>
                )}
                <InfoTip
                  text={
                    agrupadoPorSemana
                      ? "Período longo agrupa por SEMANA: cada ponto soma os 7 dias a partir da data mostrada. A linha tracejada clara é o período anterior de mesma duração — semana 1 alinha com semana 1."
                      : "Valor dos pedidos pagos por dia. A linha tracejada clara é o período anterior de mesma duração — dia 1 alinha com dia 1."
                  }
                />
                {graficoCortado && (
                  <span className="text-[11px] font-normal text-amber-600">
                    · mostrando os primeiros 4 anos do período
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-brand-600 rounded" />
                  período atual
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed border-[#dbba8b] rounded" />
                  anterior
                </span>
              </div>
            </div>
            <AreaCompare
              points={chartFat}
              prevPoints={chartPrev}
              labels={labelsDias}
              formatValue={brl}
            />
          </Card>
          {totalPedidosPeriodo > 0 && (
            <Card className="p-5">
              <h2 className="font-semibold flex items-center gap-2 text-sm mb-4">
                <ShoppingBag className="size-4 text-brand-600" />
                Status dos pedidos
                <InfoTip text="Todos os pedidos criados no período, separados por status atual. Ajuda a ver quantos estão parados aguardando pagamento ou em produção." />
              </h2>
              <Donut
                data={donutStatus}
                centerValue={String(totalPedidosPeriodo)}
                centerLabel="pedidos no período"
              />
            </Card>
          )}
        </div>
      )}

      {/* Pedidos (catálogo) */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2 text-sm text-gray-600">
          <ShoppingBag className="size-4 text-brand-600" />
          Pedidos
        </h2>
        <Link
          href="/pedidos"
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Ver pedidos
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard
          label="Pedidos pagos hoje"
          value={ordersToday._count}
          hint={brl(ordersToday._sum.netTotal ?? 0)}
          icon={<ShoppingBag />}
          info="Quantidade e valor dos pedidos pagos hoje (desde a meia-noite, horário de São Paulo)."
        />
        <StatCard
          label="Pagos na semana"
          value={ordersWeek._count}
          hint={brl(ordersWeek._sum.netTotal ?? 0)}
          icon={<ShoppingBag />}
          info="Pedidos pagos nos últimos 7 dias, com o valor somado."
        />
        {/* o cartão "Pagos no período" saiu de propósito (decisão do dono,
            26/08/2026): era o MESMO número do rodapé de "Vendas" lá em cima,
            e o "valor médio" repetia o cartão "Ticket médio" — número dito
            duas vezes ocupa espaço e não informa */}
        <StatCard
          label="Taxa de recompra"
          value={repurchaseRate}
          format="pct"
          hint="clientes com 2+ pedidos"
          icon={<Repeat />}
          tone={repurchaseRate >= 30 ? "good" : "warn"}
          info="De todos os clientes que já compraram, quantos fizeram 2 pedidos pagos ou mais."
        />
        <StatCard
          label="Estoque baixo"
          value={lowStockCount}
          hint={`variações com ≤ ${companyCfg.lowStockThreshold} peças`}
          icon={<Package />}
          tone={lowStockCount > 0 ? "warn" : "good"}
          info="Variações (cor/tamanho) de produtos ativos com estoque no limite definido pela loja. Veja a lista e ajuste o limite na tela Produtos."
        />
      </div>

      {(topItems.length > 0 || topBuyers.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-6">
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Package className="size-4 text-brand-600" />
              Produtos mais vendidos
              <InfoTip text="Peças mais vendidas em pedidos PAGOS no período, somadas pelo produto do cadastro (nome atual — renomear a peça junta o histórico). Pedido cancelado ou sem pagamento não conta." />
            </h2>
            {topItems.length === 0 ? (
              <EmptyState title="Nenhum pedido ainda" />
            ) : (
              <BarList
                data={topItems.map((i) => ({
                  label: i.name,
                  value: i.quantidade,
                }))}
                formatValue={(v) => `${v} un.`}
              />
            )}
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Gem className="size-4 text-emerald-600" />
              Clientes que mais compram
              <InfoTip text="Clientes que mais gastaram em pedidos PAGOS no período. Mostra o total gasto e quantos pedidos cada um fez." />
            </h2>
            {topBuyers.length === 0 ? (
              <EmptyState title="Nenhum pedido ainda" />
            ) : (
              <BarList
                color="#10b981"
                data={topBuyers.map((b) => ({
                  label: buyerName.get(b.customerId) ?? "Cliente",
                  value: b._sum.netTotal ?? 0,
                  sub: `${b._count} pedido${b._count === 1 ? "" : "s"}`,
                }))}
                formatValue={brl}
              />
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Próximos follow-ups */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <CalendarClock className="size-4 text-brand-600" />
              Próximos follow-ups
            </h2>
            <Link
              href="/tarefas"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Ver todas
            </Link>
          </div>
          {nextTasks.length === 0 ? (
            <EmptyState title="Nenhuma tarefa pendente" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {nextTasks.map((t) => {
                const late = t.dueAt < now;
                return (
                  <li key={t.id} className="py-2.5 flex items-center gap-3">
                    <PriorityDot priority={t.priority} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {t.customer?.name} · {taskTypeLabel[t.type]}
                      </p>
                    </div>
                    {t.assignee && (
                      <Avatar
                        name={t.assignee.name}
                        color={t.assignee.color}
                        size="sm"
                      />
                    )}
                    <span
                      className={`text-xs tabular-nums shrink-0 ${late ? "text-rose-600 font-semibold" : "text-gray-500"}`}
                    >
                      {late ? "Atrasada · " : ""}
                      {dateShort(t.dueAt)} {timeShort(t.dueAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Ranking de vendedores */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Trophy className="size-4 text-amber-500" />
            Ranking de vendedores
            <InfoTip text="Vendedores ordenados pelo valor em pedidos PAGOS no período, com a quantidade de vendas de cada um. Baseado no vendedor atribuído ao pedido." />
          </h2>
          {ranking.length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <ul className="space-y-3">
              {ranking.map((r, i) => (
                <li key={r.seller.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-300 w-4">
                    {i + 1}º
                  </span>
                  <Avatar name={r.seller.name} color={r.seller.color} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {r.seller.name}
                    </p>
                    <p className="text-xs text-gray-400">{r.count} vendas</p>
                    {r.seller.monthlyGoal > 0 && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${(soldBySeller.get(r.seller.id) ?? 0) >= r.seller.monthlyGoal ? "bg-emerald-500" : "bg-brand-500"}`}
                            style={{ width: `${Math.min(100, ((soldBySeller.get(r.seller.id) ?? 0) / r.seller.monthlyGoal) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                          {Math.round(((soldBySeller.get(r.seller.id) ?? 0) / r.seller.monthlyGoal) * 100)}% da meta
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {brl(r.totalVendido)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Clientes esfriando */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              Clientes sem contato
            </h2>
            <Link
              href="/clientes"
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Ver clientes
            </Link>
          </div>
          {noContactCustomers.length === 0 ? (
            <EmptyState title="Todos os clientes com contato recente 🎉" />
          ) : (
            <ul className="divide-y divide-gray-50">
              {noContactCustomers.map((c) => (
                <li key={c.id} className="py-2.5 flex items-center gap-3">
                  <Avatar name={c.name} color="#94a3b8" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/clientes/${c.id}`}
                      className="text-sm font-medium truncate hover:text-brand-600 block"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-gray-400">
                      {c.city ?? "—"} · {c.owner?.name ?? "sem responsável"}
                    </p>
                  </div>
                  <span className="text-xs text-amber-600 font-medium shrink-0">
                    {c.lastContactAt
                      ? `${daysSince(c.lastContactAt)} dia${daysSince(c.lastContactAt) === 1 ? "" : "s"} sem contato`
                      : "nunca contatado"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Interesses mais procurados */}
        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Shirt className="size-4 text-brand-600" />
            Produtos mais procurados
          </h2>
          {topInterests.length === 0 ? (
            <EmptyState title="Sem interesses registrados" />
          ) : (
            <BarList
              data={topInterests}
              formatValue={(v) => `${v} cliente${v === 1 ? "" : "s"}`}
            />
          )}
        </Card>
      </div>

      {user.role === "SELLER" && (
        <p className="text-xs text-gray-400 mt-6">
          Você está vendo apenas os seus clientes e atendimentos.{" "}
          {relativeDays(now)}
        </p>
      )}
    </div>
  );
}
