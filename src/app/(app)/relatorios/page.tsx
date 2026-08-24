import {
  BarChart3,
  TrendingUp,
  Users,
  Clock,
  XCircle,
  Gem,
  Moon,
  Shirt,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isManagerUp } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { brl, dateShort, originLabel } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { AreaChart, BarList, FunnelBars, PeriodChips, StatTile } from "@/components/charts";
import { lerPeriodo, periodoPorExtenso } from "@/lib/periodo";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  // Relatórios são visão geral da loja: vendedor comum não acessa
  if (!isManagerUp(user)) redirect("/dashboard");
  const now = new Date();

  // PERÍODO ESCOLHIDO PELA LOJISTA (atalhos ou datas a dedo).
  // Antes era 90 dias FIXOS no código: não dava para ver o mês fechado, a
  // Black Friday, nem comparar duas semanas de campanha.
  const { de, ate } = await searchParams;
  const filtro = lerPeriodo({ de, ate });
  const periodo = filtro.personalizado
    ? filtro.period
    : { from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), to: now };
  const rotuloPeriodo = filtro.personalizado
    ? periodoPorExtenso(filtro)
    : "últimos 90 dias";

  // Venda = pedido PAGO (fonte única da verdade, igual Dashboard/Inteligência).
  // Inclui vendas integradas (Nuvemshop etc.), que entram como pedido pago
  // direto — o modelo Sale não cobre esses fluxos e subcontava.
  const paidScope = {
    companyId: user.companyId,
    status: { in: PAID_ORDER_STATUSES },
  };
  const [sales, sellers, stages, opps, allCustomers, interests, tarefasAtrasadas, tarefasPendentes, primeirasIn, primeirasOut] =
    await Promise.all([
      db.order.findMany({
        where: { ...paidScope, paidAt: { gte: periodo.from, lte: periodo.to } },
        select: { netTotal: true, paidAt: true, sellerId: true },
      }),
      // sem filtro de ativo: quem vendeu no período aparece no ranking mesmo
      // depois de desligado (senão o gráfico não fecha com o faturamento)
      db.user.findMany({ where: { companyId: user.companyId } }),
      db.stage.findMany({
        where: { pipeline: { companyId: user.companyId } },
        orderBy: { order: "asc" },
        include: { _count: { select: { opportunities: true } } },
      }),
      db.opportunity.findMany({ where: { companyId: user.companyId } }),
      // a base inteira de clientes, com TODOS os pedidos pagos de cada uma —
      // serve para canais, inativos, origem e mais valiosos (uma consulta só;
      // antes eram duas iguais, uma em cima da outra)
      db.customer.findMany({
        where: { companyId: user.companyId },
        include: {
          orders: {
            where: { status: { in: PAID_ORDER_STATUSES } },
            select: { netTotal: true, paidAt: true },
          },
        },
      }),
      db.interest.findMany({
        where: { companyId: user.companyId },
        include: { _count: { select: { customers: true } } },
      }),
      // TAREFA ATRASADA, não "toda tarefa pendente da história": 224 tarefas
      // sem prazo viravam um número que ninguém ia zerar — o que cobra ação é
      // a tarefa que VENCEU e não foi feita
      db.task.count({
        where: { companyId: user.companyId, status: "PENDENTE", dueAt: { lt: now } },
      }),
      db.task.count({
        where: { companyId: user.companyId, status: "PENDENTE" },
      }),
      // 1ª RESPOSTA sem carregar a loja inteira na memória: só o instante da
      // primeira mensagem de cada lado, agregado pelo banco. Antes vinham
      // TODAS as mensagens de TODAS as conversas — na escala já medida
      // (120 mil mensagens) a tela não abriria. `kind: TEXT` porque nota
      // interna (e a nota de anúncio, que entra como IN) não é resposta.
      db.message.groupBy({
        by: ["conversationId"],
        where: { kind: "TEXT", direction: "IN", conversation: { companyId: user.companyId } },
        _min: { createdAt: true },
      }),
      db.message.groupBy({
        by: ["conversationId"],
        where: { kind: "TEXT", direction: "OUT", conversation: { companyId: user.companyId } },
        _min: { createdAt: true },
      }),
    ]);

  const DIA_MS = 24 * 60 * 60 * 1000;
  const noPeriodo = (d: Date | null): d is Date =>
    !!d && d >= periodo.from && d <= periodo.to;
  /** "1 dia" / "N dias" — o singular importa numa tela que o dono lê. */
  const dias = (n: number) => {
    const v = Math.round(n);
    return `${v} ${v === 1 ? "dia" : "dias"}`;
  };

  // ---- Canais de aquisição (Lead Intake Engine) ----
  //
  // TUDO DO PERÍODO ESCOLHIDO — antes era o histórico completo, na mesma tela
  // em que o faturamento era do período: os números não conversavam entre si
  // e, conforme a loja crescesse, iam parecer errados um ao lado do outro.
  //   • leads   = clientes que ENTRARAM no período;
  //   • valor   = pedidos PAGOS no período (bate com o cartão de faturamento);
  //   • conversão = desses leads do período, quantos já compraram.
  type ChannelStat = {
    origin: string;
    leads: number;
    buyers: number;
    revenue: number;
    orders: number;
    daysToSale: number[];
  };
  const channelMap = new Map<string, ChannelStat>();
  for (const c of allCustomers) {
    const key = originLabel[c.origin];
    const stat =
      channelMap.get(key) ??
      { origin: key, leads: 0, buyers: 0, revenue: 0, orders: 0, daysToSale: [] };
    const chegouNoPeriodo = c.createdAt >= periodo.from && c.createdAt <= periodo.to;
    if (chegouNoPeriodo) {
      stat.leads += 1;
      if (c.orders.length > 0) stat.buyers += 1;
    }
    const pagosNoPeriodo = c.orders.filter((o) => noPeriodo(o.paidAt));
    stat.revenue += pagosNoPeriodo.reduce((s, v) => s + v.netTotal, 0);
    stat.orders += pagosNoPeriodo.length;
    // tempo até a venda: clientes cuja PRIMEIRA compra caiu no período
    const pagas = c.orders.map((o) => o.paidAt).filter((d): d is Date => !!d);
    if (pagas.length) {
      const primeira = pagas.reduce((min, d) => (d < min ? d : min), pagas[0]);
      if (noPeriodo(primeira)) {
        stat.daysToSale.push(
          Math.max(0, (primeira.getTime() - c.createdAt.getTime()) / DIA_MS)
        );
      }
    }
    if (stat.leads || stat.revenue || stat.orders) channelMap.set(key, stat);
  }
  const channels = [...channelMap.values()].sort(
    (a, b) => b.revenue - a.revenue || b.leads - a.leads
  );
  const bestChannel = channels[0];
  const avgDaysToSale = (() => {
    const all = channels.flatMap((c) => c.daysToSale);
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  })();

  // tempo médio até a primeira resposta (1ª msg OUT depois da 1ª IN).
  // Conversa que a LOJA puxou primeiro fica de fora: ali não há "resposta".
  const primeiraIn = new Map(
    primeirasIn.map((r) => [r.conversationId, r._min.createdAt])
  );
  const responseTimes: number[] = [];
  for (const r of primeirasOut) {
    const entrada = primeiraIn.get(r.conversationId);
    const saida = r._min.createdAt;
    if (!entrada || !saida || saida <= entrada) continue;
    // SÓ conversas que CHEGARAM no período: o cartão era do histórico
    // inteiro numa seção rotulada com o período — melhorar o atendimento
    // nunca mexia no número (auditoria 24/08/2026)
    if (!noPeriodo(entrada)) continue;
    responseTimes.push((saida.getTime() - entrada.getTime()) / 60000);
  }
  const avgResponseMin = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;
  const fmtDuration = (min: number) => {
    if (min >= 60 * 24) {
      const d = (min / (60 * 24)).toFixed(1);
      return `${d} ${d === "1.0" ? "dia" : "dias"}`;
    }
    return min >= 60 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} min`;
  };

  // VENDAS AO LONGO DO PERÍODO ESCOLHIDO.
  //
  // Antes eram "as últimas 12 semanas" contadas a partir de hoje, sempre.
  // Com o período escolhido a dedo isso mentiria: pedindo "julho fechado", o
  // gráfico mostraria 12 semanas até hoje e quase todas em zero — porque as
  // vendas carregadas são só as de julho.
  //
  // Agora as barras cobrem exatamente o período. Período curto vira DIA a dia
  // (uma barra por semana num intervalo de 10 dias não diz nada); período
  // longo continua por semana.
  const duracaoDias = Math.max(
    1,
    Math.ceil((periodo.to.getTime() - periodo.from.getTime()) / DIA_MS)
  );
  const porDia = duracaoDias <= 31;
  // período longo NÃO corta o gráfico: o PASSO cresce (semana → quinzena →
  // mês) até caber em 26 barras. Cortar barras fazia o gráfico mostrar
  // metade do período com o rótulo do período inteiro — o cartão de
  // faturamento somava tudo e os números "não conversavam".
  const passoDias = porDia ? 1 : Math.max(7, Math.ceil(duracaoDias / 26 / 7) * 7);
  const passoMs = passoDias * DIA_MS;
  const quantosBlocos = Math.max(1, Math.ceil(duracaoDias / passoDias));
  // blocos ancorados no INÍCIO do período: assim só a ÚLTIMA barra pode ser
  // parcial (o bloco "em andamento", que todo mundo entende). Ancorar no fim
  // deixava a PRIMEIRA barra coberta pela metade — parecia queda de vendas
  // onde só havia bloco cortado (auditoria 07/08/2026).
  const weeks: { label: string; total: number }[] = [];
  for (let i = 0; i < quantosBlocos; i++) {
    const start = new Date(periodo.from.getTime() + i * passoMs);
    const end = new Date(Math.min(start.getTime() + passoMs, periodo.to.getTime()));
    weeks.push({
      // a barra leva o nome do dia em que COMEÇA: `end` é a meia-noite do dia
      // SEGUINTE ao último coberto, e rotular por ele deslocava o gráfico em
      // +1 dia (a venda de segunda aparecia na barra "terça"; na semana, os
      // sete dias caíam na barra com a data da semana seguinte — auditoria
      // 24/08/2026). Como os blocos ancoram no início, o rótulo do início é
      // o único que sempre aponta um dia realmente coberto.
      label: dateShort(start),
      total: sales
        .filter(
          (s) =>
            s.paidAt &&
            (i === 0 ? s.paidAt >= start : s.paidAt > start) &&
            s.paidAt <= end
        )
        .reduce((sum, s) => sum + s.netTotal, 0),
    });
  }

  // vendas por vendedor — com a linha da LOJA: pedido sem vendedora
  // (Nuvemshop, catálogo sem link) existe e é dinheiro; sem a linha, as
  // barras somavam menos que o cartão de Faturamento e parecia venda sumida
  const semVendedora = sales
    .filter((v) => !v.sellerId)
    .reduce((sum, v) => sum + v.netTotal, 0);
  const bySeller = [
    ...sellers.map((s) => ({
      label: s.name,
      value: sales
        .filter((v) => v.sellerId === s.id)
        .reduce((sum, v) => sum + v.netTotal, 0),
    })),
    ...(semVendedora > 0 ? [{ label: "Loja (sem vendedora)", value: semVendedora }] : []),
  ]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // funil: contagem por etapa (histórico de oportunidades)
  const funnel = stages.map((s) => ({
    label: s.name,
    value: s._count.opportunities,
  }));

  // motivos de perda
  const lostReasons = new Map<string, number>();
  for (const o of opps.filter((o) => o.status === "LOST")) {
    const reason = o.lostReason?.trim() || "Sem motivo registrado";
    lostReasons.set(reason, (lostReasons.get(reason) ?? 0) + 1);
  }
  const lossData = [...lostReasons.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // origem dos clientes (base inteira)
  const byOrigin = new Map<string, number>();
  for (const c of allCustomers) {
    const label = originLabel[c.origin];
    byOrigin.set(label, (byOrigin.get(label) ?? 0) + 1);
  }
  const originData = [...byOrigin.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // clientes mais valiosos (base inteira)
  const topCustomers = allCustomers
    .map((c) => ({
      label: c.name,
      value: c.orders.reduce((s, v) => s + v.netTotal, 0),
    }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // QUEM PAROU DE COMPRAR ≠ QUEM NUNCA COMPROU.
  //
  // Antes os dois entravam no mesmo saco e o cartão mostrava o mesmo número
  // em 30, 60 e 90 dias (quase todo mundo era "inativo" por nunca ter
  // comprado). Cliente inativa é a que COMPRAVA e sumiu — essa se liga e
  // recupera; quem nunca comprou é lead, e o trabalho é outro (1ª venda).
  //
  // A data da última compra vem DOS PRÓPRIOS PEDIDOS PAGOS, a mesma fonte do
  // faturamento — o carimbo `lastPurchaseAt` não é gravado em todos os
  // caminhos e fazia a conta não fechar (217 − 7 ≠ 209).
  const ultimaCompra = (c: { orders: { paidAt: Date | null }[] }): Date | null =>
    c.orders.reduce<Date | null>(
      (max, o) => (o.paidAt && (!max || o.paidAt > max) ? o.paidAt : max),
      null
    );
  const compradores = allCustomers.filter((c) => c.orders.length > 0);
  const leadsSemCompra = allCustomers.length - compradores.length;
  const pararam = (days: number) => {
    const corte = new Date(now.getTime() - days * DIA_MS);
    return compradores.filter((c) => {
      const u = ultimaCompra(c);
      return u !== null && u < corte;
    }).length;
  };

  // tempo médio de fechamento (ganhas)
  const won = opps.filter((o) => o.status === "WON" && o.closedAt);
  const avgClose =
    won.length > 0
      ? won.reduce(
          (s, o) =>
            s +
            (o.closedAt!.getTime() - o.createdAt.getTime()) /
              (24 * 60 * 60 * 1000),
          0
        ) / won.length
      : 0;

  // produtos mais desejados
  const desired = interests
    .map((i) => ({ label: i.name, value: i._count.customers }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);

  const totalPeriodo = sales.reduce((s, v) => s + v.netTotal, 0);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Relatórios"
        subtitle={`Números do período escolhido (${rotuloPeriodo}); os blocos marcados com “histórico” olham a base inteira de clientes.`}
      />

      <div className="mb-5">
        <PeriodChips pathname="/relatorios" de={de} ate={ate} allLabel="90 dias" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatTile
          label={`Faturamento (${filtro.personalizado ? "período" : "90d"})`}
          value={brl(totalPeriodo)}
          hint={`${sales.length} venda${sales.length === 1 ? "" : "s"}`}
          icon={<TrendingUp />}
        />
        {/* os dois tiles abaixo são HISTÓRICO (base inteira), não o período
            do filtro — a marca no rodapé cumpre a promessa do subtítulo */}
        <StatTile
          label="Tempo médio de fechamento"
          value={dias(avgClose)}
          hint={`${won.length === 1 ? "1 negociação ganha" : `${won.length} negociações ganhas`} · histórico`}
          icon={<Clock />}
        />
        <StatTile
          label="Pararam de comprar (60d+)"
          value={String(pararam(60))}
          hint={`${pararam(30)} há 30d+ · ${leadsSemCompra} leads nunca compraram · histórico, contado de hoje`}
          icon={<Moon />}
          tone={pararam(60) > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Tarefas atrasadas"
          value={String(tarefasAtrasadas)}
          hint={`de ${tarefasPendentes} pendentes no total`}
          icon={<Users />}
          tone={tarefasAtrasadas > 0 ? "warn" : "good"}
        />
      </div>

      {/* Canais de aquisição — mesmo período dos cartões de cima */}
      <h2 className="font-semibold mb-3 text-sm text-gray-600">
        Canais de aquisição <span className="font-normal text-gray-400">({rotuloPeriodo})</span>
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
        <StatTile
          label="Melhor canal"
          value={bestChannel?.origin ?? "—"}
          hint={
            bestChannel
              ? bestChannel.revenue > 0
                ? `${brl(bestChannel.revenue)} vendidos`
                : `${bestChannel.leads} leads (sem venda no período)`
              : undefined
          }
          tone="good"
        />
        <StatTile
          label="1ª resposta (média)"
          value={fmtDuration(avgResponseMin)}
          hint={`${responseTimes.length} conversa${responseTimes.length === 1 ? "" : "s"} do período respondida${responseTimes.length === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Tempo até a venda"
          value={dias(avgDaysToSale)}
          hint={`do cadastro à 1ª compra · ${channels.reduce((a, c) => a + c.daysToSale.length, 0)} clientes estrearam`}
        />
        <StatTile
          label="Canais ativos"
          value={String(channels.length)}
          hint="origens com movimento no período"
        />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 md:gap-6 mb-6">
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Leads por origem <span className="text-xs font-normal text-gray-400">· {rotuloPeriodo}</span></h2>
          <BarList
            data={channels
              .filter((c) => c.leads > 0)
              .sort((a, b) => b.leads - a.leads)
              .map((c) => ({ label: c.origin, value: c.leads }))}
            formatValue={(v) => `${v}`}
          />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Valor vendido por canal <span className="text-xs font-normal text-gray-400">· {rotuloPeriodo}</span></h2>
          <BarList
            color="#10b981"
            data={channels
              .filter((c) => c.revenue > 0)
              .map((c) => ({
                label: c.origin,
                value: c.revenue,
                // ticket médio POR PEDIDO. Dividir pelo nº de clientes (como
                // era) infla o ticket assim que alguém recompra — e recompra
                // é justamente a graça do atacado.
                sub: `ticket médio ${brl(c.orders ? c.revenue / c.orders : 0)} · ${c.orders} pedido${c.orders === 1 ? "" : "s"}`,
              }))}
            formatValue={brl}
          />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Conversão por origem <span className="text-xs font-normal text-gray-400">· leads do período</span></h2>
          <BarList
            color="#0ea5e9"
            data={channels
              .filter((c) => c.leads > 0)
              .sort((a, b) => b.buyers / b.leads - a.buyers / a.leads)
              .map((c) => ({
                label: c.origin,
                value: Math.round((c.buyers / c.leads) * 100),
                sub: `${c.buyers} de ${c.leads} leads do período compraram`,
              }))}
            formatValue={(v) => `${v}%`}
          />
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <BarChart3 className="size-4 text-brand-600" />
            Vendas por {porDia ? "dia" : passoDias === 7 ? "semana" : `${passoDias} dias`}{" "}
            <span className="text-xs font-normal text-gray-400">· {rotuloPeriodo}</span>
          </h2>
          <AreaChart
            points={weeks.map((w) => w.total)}
            labels={weeks.map((w) => w.label)}
            formatValue={brl}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">
            Vendas por vendedor{" "}
            <span className="text-xs font-normal text-gray-400">· {rotuloPeriodo}</span>
          </h2>
          {bySeller.length === 0 ? (
            <EmptyState title="Sem vendas no período" />
          ) : (
            <BarList data={bySeller} formatValue={brl} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">Oportunidades por etapa do funil <span className="text-xs font-normal text-gray-400">· posição atual</span></h2>
          <FunnelBars data={funnel} />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <XCircle className="size-4 text-rose-500" />
            Motivos de perda <span className="text-xs font-normal text-gray-400">· histórico</span>
          </h2>
          {lossData.length === 0 ? (
            <EmptyState title="Nenhuma negociação perdida 🎉" />
          ) : (
            <BarList
              data={lossData}
              color="#e34948"
              formatValue={(v) => `${v} negócio${v === 1 ? "" : "s"}`}
            />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">Origem dos clientes <span className="text-xs font-normal text-gray-400">· histórico</span></h2>
          <BarList
            data={originData}
            color="#0ea5e9"
            formatValue={(v) => `${v}`}
          />
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Gem className="size-4 text-brand-600" />
            Clientes mais valiosos <span className="text-xs font-normal text-gray-400">· histórico</span>
          </h2>
          {topCustomers.length === 0 ? (
            <EmptyState title="Sem compras registradas" />
          ) : (
            <BarList data={topCustomers} color="#10b981" formatValue={brl} />
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-4">
            <Shirt className="size-4 text-brand-600" />
            Produtos mais desejados
          </h2>
          {desired.length === 0 ? (
            <EmptyState title="Sem interesses registrados" />
          ) : (
            <BarList
              data={desired}
              formatValue={(v) => `${v} cliente${v === 1 ? "" : "s"}`}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
