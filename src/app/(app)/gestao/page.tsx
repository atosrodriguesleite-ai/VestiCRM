import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { spNow } from "@/lib/billing";
import {
  lifetimeMeses,
  calcularMRR,
  situacaoCobranca,
  emRisco,
  canalDoLead,
  valorDaCobranca,
  FONTE_AUDITORIA,
  type CanalDeLead,
} from "@/lib/gestao";
import { GestaoView, type LojaGestao, type Intercorrencia } from "./gestao-view";

export const dynamic = "force-dynamic";

/**
 * PAINEL DE GESTÃO — a tela do dono da plataforma.
 *
 * Junta num lugar só o que decide o negócio: quanto entra por mês, quanto
 * cada loja movimenta, há quanto tempo cada cliente está com a gente, de onde
 * vêm os leads e o que está quebrando. Só Super Admin.
 */
export default async function GestaoPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");

  // ---- Janela do mês corrente (fuso de São Paulo) ----
  const sp = spNow();
  const inicioMes = new Date(Date.UTC(sp.y, sp.m - 1, 1, 3, 0, 0));
  const inicioMesPassado = new Date(Date.UTC(sp.y, sp.m - 2, 1, 3, 0, 0));
  const agora = new Date();
  const dias30 = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dias7 = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  // início do mês QUE VEM: fecha a janela do mês corrente, senão um pagamento
  // lançado com data futura entraria no caixa deste mês
  const inicioProximoMes = new Date(Date.UTC(sp.y, sp.m, 1, 3, 0, 0));

  const [companies, plataforma, erros, intercorrenciasTotal] = await Promise.all([
    db.company.findMany({
      where: { slug: { not: PLATFORM_SLUG } },
      orderBy: { createdAt: "desc" },
      include: {
        billing: true,
        // orders aqui é o TOTAL de pedidos da loja (histórico inteiro) — é o
        // número que aparece no aviso de exclusão, então tem que ser real
        _count: { select: { users: true, customers: true, products: true, orders: true } },
        users: {
          where: { role: "ADMIN" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { name: true, email: true },
        },
      },
    }),
    db.company.findUnique({ where: { slug: PLATFORM_SLUG }, select: { id: true } }),
    // a lista mostra as 40 mais recentes; "auditoria" são ações do próprio
    // Super Admin (ex.: exclusão de loja) — ficam registradas, mas não são
    // defeito do sistema
    db.errorLog.findMany({
      where: { source: { not: FONTE_AUDITORIA } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    // o indicador conta de VERDADE (últimos 7 dias) — antes ele travava em 40
    // por causa do `take`, e 40 erros pareciam iguais a 4.000
    db.errorLog.count({
      where: { source: { not: FONTE_AUDITORIA }, createdAt: { gte: dias7 } },
    }),
  ]);

  const ids = companies.map((c) => c.id);

  // ---- Movimento das lojas: faturamento e pedidos PAGOS (data do pagamento) ----
  const [pagosMes, pagosMesPassado, pedidosGeradosMes, ultimoAcessoRows, whats, pagamentos] =
    await Promise.all([
      db.order.groupBy({
        by: ["companyId"],
        where: { companyId: { in: ids }, status: { in: PAID_ORDER_STATUSES }, paidAt: { gte: inicioMes } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      db.order.groupBy({
        by: ["companyId"],
        where: {
          companyId: { in: ids },
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gte: inicioMesPassado, lt: inicioMes },
        },
        _sum: { total: true },
      }),
      db.order.groupBy({
        by: ["companyId"],
        where: { companyId: { in: ids }, createdAt: { gte: inicioMes } },
        _count: { _all: true },
      }),
      db.user.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true, lastActiveAt: true },
      }),
      db.commSettings.findMany({
        select: { companyId: true, evolutionStatus: true, evolutionPhone: true },
      }),
      // só pagamentos DAS LOJAS: sem o filtro, cobranças lançadas na própria
      // empresa-plataforma entravam no caixa e o total do rodapé (que soma
      // loja a loja) não fechava com o indicador do topo
      db.billingPayment.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true, kind: true, amount: true, paidAt: true },
      }),
    ]);

  const fatMes = new Map(pagosMes.map((r) => [r.companyId, { total: r._sum.total ?? 0, pedidos: r._count._all }]));
  const fatAnterior = new Map(pagosMesPassado.map((r) => [r.companyId, r._sum.total ?? 0]));
  const geradosMes = new Map(pedidosGeradosMes.map((r) => [r.companyId, r._count._all]));
  const whatsBy = new Map(whats.map((w) => [w.companyId, w]));
  const acessoBy = new Map<string, Date | null>();
  for (const u of ultimoAcessoRows) {
    const atual = acessoBy.get(u.companyId) ?? null;
    if (u.lastActiveAt && (!atual || u.lastActiveAt > atual)) acessoBy.set(u.companyId, u.lastActiveAt);
    else if (!acessoBy.has(u.companyId)) acessoBy.set(u.companyId, atual);
  }
  const pagosPorLoja = new Map<string, number>();
  for (const p of pagamentos) {
    pagosPorLoja.set(p.companyId, (pagosPorLoja.get(p.companyId) ?? 0) + p.amount);
  }

  // ---- Lojas: uma linha completa por cliente ----
  const lojas: LojaGestao[] = companies.map((c) => {
    const b = c.billing;
    const kind = b?.kind ?? "TESTE";
    const monthlyFee = b?.monthlyFee ?? 0;
    const cycle = b?.cycle ?? "MENSAL";
    const mov = fatMes.get(c.id) ?? { total: 0, pedidos: 0 };
    const ultimoAcesso = acessoBy.get(c.id) ?? null;
    const w = whatsBy.get(c.id);
    return {
      id: c.id,
      nome: c.name,
      slug: c.slug,
      responsavel: c.users[0]?.name ?? null,
      email: c.users[0]?.email ?? null,
      criadaEm: c.createdAt.toISOString(),
      lifetimeMeses: lifetimeMeses(c.createdAt, agora),
      suspensa: c.suspended,
      kind,
      cycle,
      monthlyFee,
      valorCobranca: valorDaCobranca(monthlyFee, cycle),
      implementationFee: b?.implementationFee ?? 0,
      implementationPaid: b?.implementationPaid ?? false,
      dueDay: b?.dueDay ?? 10,
      situacao: situacaoCobranca({
        kind,
        monthlyFee,
        dueDay: b?.dueDay ?? 10,
        paidThrough: b?.paidThrough ?? null,
        hoje: agora,
      }),
      jaGerou: pagosPorLoja.get(c.id) ?? 0,
      faturamentoMes: mov.total,
      pedidosPagosMes: mov.pedidos,
      faturamentoMesAnterior: fatAnterior.get(c.id) ?? 0,
      pedidosGeradosMes: geradosMes.get(c.id) ?? 0,
      usuarios: c._count.users,
      clientes: c._count.customers,
      produtos: c._count.products,
      totalPedidos: c._count.orders,
      ultimoAcesso: ultimoAcesso?.toISOString() ?? null,
      emRisco: emRisco({ suspended: c.suspended, kind, ultimoAcesso }, 14, agora),
      whatsapp: w?.evolutionStatus ?? "DESCONECTADO",
      whatsappPhone: w?.evolutionPhone ?? null,
      notas: b?.notes ?? null,
    };
  });

  // ---- Leads da PLATAFORMA por canal de entrada ----
  const leadsPlataforma = plataforma
    ? await db.customer.findMany({
        where: { companyId: plataforma.id },
        select: { origin: true, landingSource: true, createdAt: true },
      })
    : [];
  const canais: Record<CanalDeLead, { total: number; mes: number; dias30: number }> = {
    LANDING: { total: 0, mes: 0, dias30: 0 },
    BIO: { total: 0, mes: 0, dias30: 0 },
    CATALOGO_PLATAFORMA: { total: 0, mes: 0, dias30: 0 },
    CATALOGO_LOJAS: { total: 0, mes: 0, dias30: 0 },
    OUTROS: { total: 0, mes: 0, dias30: 0 },
  };
  for (const l of leadsPlataforma) {
    const canal = canalDoLead(l);
    canais[canal].total += 1;
    if (l.createdAt >= inicioMes) canais[canal].mes += 1;
    if (l.createdAt >= dias30) canais[canal].dias30 += 1;
  }
  // leads que as LOJAS captaram nos catálogos delas (volume do produto em uso)
  const [leadsLojasTotal, leadsLojasMes, leadsLojas30] = await Promise.all([
    db.customer.count({ where: { companyId: { in: ids }, origin: "CATALOGO_PUBLICO" } }),
    db.customer.count({
      where: { companyId: { in: ids }, origin: "CATALOGO_PUBLICO", createdAt: { gte: inicioMes } },
    }),
    db.customer.count({
      where: { companyId: { in: ids }, origin: "CATALOGO_PUBLICO", createdAt: { gte: dias30 } },
    }),
  ]);
  canais.CATALOGO_LOJAS = { total: leadsLojasTotal, mes: leadsLojasMes, dias30: leadsLojas30 };

  // ---- Caixa do mês (o que a plataforma recebeu) ----
  const noMes = (p: { paidAt: Date }) => p.paidAt >= inicioMes && p.paidAt < inicioProximoMes;
  const recebidoMes = pagamentos.filter(noMes).reduce((s, p) => s + p.amount, 0);
  const recebidoImplantacaoMes = pagamentos
    .filter((p) => noMes(p) && p.kind === "IMPLEMENTACAO")
    .reduce((s, p) => s + p.amount, 0);
  const recebidoMesAnterior = pagamentos
    .filter((p) => p.paidAt >= inicioMesPassado && p.paidAt < inicioMes)
    .reduce((s, p) => s + p.amount, 0);

  const mrr = calcularMRR(
    lojas.map((l) => ({ suspended: l.suspensa, kind: l.kind, monthlyFee: l.monthlyFee }))
  );

  const intercorrencias: Intercorrencia[] = erros.map((e) => ({
    id: e.id,
    origem: e.source,
    caminho: e.path,
    mensagem: e.message,
    detalhe: e.detail,
    quando: e.createdAt.toISOString(),
  }));

  return (
    <GestaoView
      lojas={lojas}
      canais={canais}
      intercorrencias={intercorrencias}
      resumo={{
        mrr,
        recebidoMes,
        recebidoImplantacaoMes,
        recebidoMesAnterior,
        aReceberImplantacao: lojas
          .filter((l) => !l.implementationPaid)
          .reduce((s, l) => s + l.implementationFee, 0),
        faturamentoLojasMes: lojas.reduce((s, l) => s + l.faturamentoMes, 0),
        pedidosLojasMes: lojas.reduce((s, l) => s + l.pedidosPagosMes, 0),
        lojasAtivas: lojas.filter((l) => !l.suspensa).length,
        lojasPagantes: lojas.filter((l) => l.kind === "PAGANTE" && !l.suspensa).length,
        // "em teste" tem que ser subconjunto das ATIVAS, senão o rodapé do
        // cartão pode somar mais do que o número grande em cima dele
        lojasTeste: lojas.filter((l) => l.kind === "TESTE" && !l.suspensa).length,
        lojasSuspensas: lojas.filter((l) => l.suspensa).length,
        emRisco: lojas.filter((l) => l.emRisco).length,
        atrasados: lojas.filter((l) => l.situacao === "ATRASADO").length,
        // tempo médio de casa das lojas VIVAS (loja suspensa não é mais base
        // de cliente — puxava a média para cima sem significar nada)
        ltMedio: (() => {
          const vivas = lojas.filter((l) => !l.suspensa);
          if (!vivas.length) return 0;
          return Math.round((vivas.reduce((s, l) => s + l.lifetimeMeses, 0) / vivas.length) * 10) / 10;
        })(),
        intercorrencias7d: intercorrenciasTotal,
      }}
    />
  );
}
