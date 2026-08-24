import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { spNow } from "@/lib/billing";
import type { Origin } from "@prisma/client";
import {
  lifetimeMeses,
  calcularMRR,
  situacaoCobranca,
  tipoDeRisco,
  canalDoLead,
  valorDaCobranca,
  horasForaDoAr,
  FONTE_AUDITORIA,
  ehLojaDemo,
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
  // as contas da plataforma ignoram a loja de demonstração (dados inventados)
  const idsReais = companies.filter((c) => !ehLojaDemo(c.slug)).map((c) => c.id);

  // ---- Movimento das lojas: faturamento e pedidos PAGOS (data do pagamento) ----
  const [pagosMes, pagosMesPassado, pedidosGeradosMes, ultimoAcessoRows, whats, pagamentos] =
    await Promise.all([
      db.order.groupBy({
        by: ["companyId"],
        where: { companyId: { in: ids }, status: { in: PAID_ORDER_STATUSES }, paidAt: { gte: inicioMes } },
        _sum: { netTotal: true },
        _count: { _all: true },
      }),
      db.order.groupBy({
        by: ["companyId"],
        where: {
          companyId: { in: ids },
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gte: inicioMesPassado, lt: inicioMes },
        },
        _sum: { netTotal: true },
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
        where: { companyId: { in: ids } },
        select: {
          companyId: true,
          evolutionStatus: true,
          evolutionPhone: true,
          // desde quando o número está fora do ar (o vigia marca na queda)
          evolutionDownSince: true,
        },
      }),
      // só pagamentos DAS LOJAS: sem o filtro, cobranças lançadas na própria
      // empresa-plataforma entravam no caixa e o total do rodapé (que soma
      // loja a loja) não fechava com o indicador do topo
      db.billingPayment.findMany({
        where: { companyId: { in: idsReais } },
        select: { companyId: true, kind: true, amount: true, paidAt: true },
      }),
    ]);

  const fatMes = new Map(pagosMes.map((r) => [r.companyId, { total: r._sum.netTotal ?? 0, pedidos: r._count._all }]));
  const fatAnterior = new Map(pagosMesPassado.map((r) => [r.companyId, r._sum.netTotal ?? 0]));
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
      // loja de apresentação: fica na lista, mas fora de TODO indicador
      demo: ehLojaDemo(c.slug),
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
      risco: tipoDeRisco(
        { suspended: c.suspended, kind, ultimoAcesso, criadaEm: c.createdAt },
        agora
      ),
      whatsapp: w?.evolutionStatus ?? "DESCONECTADO",
      whatsappPhone: w?.evolutionPhone ?? null,
      // null = conectada, ou nunca conectou (aí não é "queda", é setup pendente)
      horasSemWhatsapp: horasForaDoAr(w?.evolutionDownSince ?? null, agora),
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
    CATALOGO_DE_LOJA: { total: 0, mes: 0, dias30: 0 },
    OUTROS: { total: 0, mes: 0, dias30: 0 },
  };
  for (const l of leadsPlataforma) {
    const canal = canalDoLead(l);
    canais[canal].total += 1;
    if (l.createdAt >= inicioMes) canais[canal].mes += 1;
    if (l.createdAt >= dias30) canais[canal].dias30 += 1;
  }
  // ---- USO DO PRODUTO: clientes que as LOJAS captaram ----
  //
  // Isto NÃO é lead da AtacadoPro: são as clientes finais das lojistas. Fica
  // num bloco à parte de propósito — misturado com os canais de aquisição, o
  // número (que é 50× maior) dava a impressão de que a plataforma recebia
  // centenas de interessados por mês.
  //
  // E conta TODAS as origens, não só o catálogo: a maior parte das clientes
  // chega pelo WhatsApp, e contar só o catálogo mostrava uma fração do
  // movimento real das lojas.
  //
  // FORA DA CONTA: as clientes que a INTEGRAÇÃO trouxe (Nuvemshop/Bling). A
  // loja que conecta a integração hoje importa a base inteira de anos com
  // `createdAt` de hoje — sem separar, "captadas no mês" saltaria para
  // milhares no dia da conexão, que é exatamente o número inflado que esta
  // tela veio consertar. Elas aparecem na linha de baixo, com o nome certo.
  const IMPORTADAS: Origin[] = ["NUVEMSHOP", "BLING"];
  const [usoPorOrigem, usoMesPorOrigem] = await Promise.all([
    db.customer.groupBy({
      by: ["origin"],
      where: { companyId: { in: idsReais } },
      _count: { _all: true },
    }),
    db.customer.groupBy({
      by: ["origin"],
      where: { companyId: { in: idsReais }, createdAt: { gte: inicioMes } },
      _count: { _all: true },
    }),
  ]);
  const somar = (
    linhas: { origin: Origin; _count: { _all: number } }[],
    quais?: Origin[]
  ) =>
    linhas
      .filter((l) => (quais ? quais.includes(l.origin) : !IMPORTADAS.includes(l.origin)))
      .reduce((s, l) => s + l._count._all, 0);
  const usoDasLojas = {
    whatsappMes: somar(usoMesPorOrigem, ["WHATSAPP"]),
    catalogoMes: somar(usoMesPorOrigem, ["CATALOGO_PUBLICO"]),
    // "outras" = tudo o que sobra das captadas (já sem as importadas)
    outrasMes:
      somar(usoMesPorOrigem) -
      somar(usoMesPorOrigem, ["WHATSAPP", "CATALOGO_PUBLICO"]),
    totalMes: somar(usoMesPorOrigem),
    total: somar(usoPorOrigem),
    importadasTotal: somar(usoPorOrigem, IMPORTADAS),
  };

  // ---- Caixa do mês (o que a plataforma recebeu) ----
  const noMes = (p: { paidAt: Date }) => p.paidAt >= inicioMes && p.paidAt < inicioProximoMes;
  const recebidoMes = pagamentos.filter(noMes).reduce((s, p) => s + p.amount, 0);
  const recebidoImplantacaoMes = pagamentos
    .filter((p) => noMes(p) && p.kind === "IMPLEMENTACAO")
    .reduce((s, p) => s + p.amount, 0);
  const recebidoMesAnterior = pagamentos
    .filter((p) => p.paidAt >= inicioMesPassado && p.paidAt < inicioMes)
    .reduce((s, p) => s + p.amount, 0);

  // ---- INDICADORES: só as lojas REAIS ----
  // A loja de demonstração tem dinheiro de mentira (coerente, mas inventado).
  // Somar ela aqui faria o painel dizer que os clientes venderam o que
  // ninguém vendeu. Ela continua na LISTA de lojas, marcada como demo.
  const reais = lojas.filter((l) => !l.demo);

  const mrr = calcularMRR(
    reais.map((l) => ({ suspended: l.suspensa, kind: l.kind, monthlyFee: l.monthlyFee }))
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
      usoDasLojas={usoDasLojas}
      intercorrencias={intercorrencias}
      resumo={{
        mrr,
        recebidoMes,
        recebidoImplantacaoMes,
        recebidoMesAnterior,
        aReceberImplantacao: reais
          .filter((l) => !l.implementationPaid)
          .reduce((s, l) => s + l.implementationFee, 0),
        faturamentoLojasMes: reais.reduce((s, l) => s + l.faturamentoMes, 0),
        pedidosLojasMes: reais.reduce((s, l) => s + l.pedidosPagosMes, 0),
        lojasAtivas: reais.filter((l) => !l.suspensa).length,
        lojasPagantes: reais.filter((l) => l.kind === "PAGANTE" && !l.suspensa).length,
        // "em teste" tem que ser subconjunto das ATIVAS, senão o rodapé do
        // cartão pode somar mais do que o número grande em cima dele
        lojasTeste: reais.filter((l) => l.kind === "TESTE" && !l.suspensa).length,
        lojasSuspensas: reais.filter((l) => l.suspensa).length,
        riscoPagantes: reais.filter((l) => l.risco === "PAGANTE_SUMIU").length,
        riscoTestes: reais.filter((l) => l.risco === "TESTE_PARADO").length,
        atrasados: reais.filter((l) => l.situacao === "ATRASADO").length,
        // tempo médio de casa das lojas VIVAS (loja suspensa não é mais base
        // de cliente — puxava a média para cima sem significar nada)
        ltMedio: (() => {
          const vivas = reais.filter((l) => !l.suspensa);
          if (!vivas.length) return 0;
          return Math.round((vivas.reduce((s, l) => s + l.lifetimeMeses, 0) / vivas.length) * 10) / 10;
        })(),
        intercorrencias7d: intercorrenciasTotal,
      }}
    />
  );
}
