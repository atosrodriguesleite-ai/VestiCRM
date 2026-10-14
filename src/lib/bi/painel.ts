/**
 * O PAINEL DO DONO (RN-082): lê os fatos diários prontos (`BiDia`) e soma
 * três números vivos baratos — quem está esperando AGORA, as vendas do mês
 * e a recompra — que vêm de colunas indexadas, nunca da tabela de mensagens.
 *
 * Toda régua de dinheiro é a de sempre: venda = pedido pago (RN-001), valor
 * = `netTotal` (RN-002); o mês é o de São Paulo.
 */
import type { BiDiaVendedora } from "@prisma/client";
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import { diaSP, inicioDoMesSP, mesSP } from "../dia";
import { contarPorMotivo } from "../funil/motivos-de-perda";
import { BALDES_MIN, VERSAO_DOS_FATOS, inicioDoDiaSP, ultimosDias } from "./fatos";
import { TIPOS_DE_META, type TipoDeMeta } from "./metas";

export type Periodo = { de: string; ate: string };

/** teto do período: um ano — acima disso os números do painel não cabem num olhar */
export const TETO_DE_DIAS = 366;

/** Encaixa o período no teto (o `de` sobe), para séries e somas lerem o MESMO recorte. */
export function encaixarPeriodo(p: Periodo): Periodo {
  const a = inicioDoDiaSP(p.de).getTime();
  const b = inicioDoDiaSP(p.ate).getTime();
  if (!(b >= a)) return { de: p.ate, ate: p.ate };
  const n = Math.round((b - a) / 86_400_000) + 1;
  return n > TETO_DE_DIAS ? { de: ultimosDias(p.ate, TETO_DE_DIAS)[0], ate: p.ate } : p;
}

/** os dias de um período (AAAA-MM-DD), do mais antigo ao mais novo */
export function diasDoPeriodo(p: Periodo): string[] {
  const a = inicioDoDiaSP(p.de).getTime();
  const b = inicioDoDiaSP(p.ate).getTime();
  if (!(b >= a)) return [];
  const n = Math.min(Math.round((b - a) / 86_400_000) + 1, TETO_DE_DIAS);
  return ultimosDias(p.ate, n);
}

/** o período de mesmo tamanho, imediatamente antes */
export function periodoAnterior(p: Periodo): Periodo {
  const dias = diasDoPeriodo(p);
  const n = dias.length || 1;
  const fim = new Date(inicioDoDiaSP(p.de).getTime() - 86_400_000 + 3 * 3_600_000);
  const ate = fim.toISOString().slice(0, 10);
  return { de: ultimosDias(ate, n)[0], ate };
}

/** variação % contra o período anterior (nulo sem base) */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

type LinhaDia = {
  dia: string;
  leads: number;
  origens: string;
  leadsRespondidos: number;
  leadsComPedido: number;
  leadsPagaram: number;
  esperas: number;
  respondidas: number;
  noPrazo: number;
  foraDoPrazo: number;
  semResposta: number;
  encerradasSemResposta: number;
  medianaMin: number | null;
  p90Min: number | null;
  hist: string;
  pedidos: number;
  pedidosPagos: number;
  vendido: number;
};

export type SomaDoPeriodo = {
  leads: number;
  leadsRespondidos: number;
  leadsComPedido: number;
  leadsPagaram: number;
  esperas: number;
  respondidas: number;
  noPrazo: number;
  foraDoPrazo: number;
  semResposta: number;
  pctNoPrazo: number | null;
  hist: number[];
  /** "metade das clientes foi respondida em até N min" — lido da distribuição */
  medianaAproxMin: number | null;
  pedidos: number;
  pedidosPagos: number;
  vendido: number;
  ticket: number | null;
  origens: Record<string, number>;
  diasComFato: number;
};

/** O que a loja e a pessoa somam DO MESMO JEITO (uma régua para as duas tabelas). */
type SomaComum = {
  leads: number;
  leadsRespondidos: number;
  leadsComPedido: number;
  leadsPagaram: number;
  respondidas: number;
  noPrazo: number;
  foraDoPrazo: number;
  semResposta: number;
  pctNoPrazo: number | null;
  hist: number[];
  medianaAproxMin: number | null;
  pedidos: number;
  pedidosPagos: number;
  vendido: number;
  ticket: number | null;
};
type LinhaComum = Omit<SomaComum, "pctNoPrazo" | "hist" | "medianaAproxMin" | "ticket"> & { hist: string };

function somaVazia(): SomaComum {
  return {
    leads: 0,
    leadsRespondidos: 0,
    leadsComPedido: 0,
    leadsPagaram: 0,
    respondidas: 0,
    noPrazo: 0,
    foraDoPrazo: 0,
    semResposta: 0,
    pctNoPrazo: null,
    hist: Array(BALDES_MIN.length + 1).fill(0),
    medianaAproxMin: null,
    pedidos: 0,
    pedidosPagos: 0,
    vendido: 0,
    ticket: null,
  };
}

function acumular(s: SomaComum, l: LinhaComum): void {
  s.leads += l.leads;
  s.leadsRespondidos += l.leadsRespondidos;
  s.leadsComPedido += l.leadsComPedido;
  s.leadsPagaram += l.leadsPagaram;
  s.respondidas += l.respondidas;
  s.noPrazo += l.noPrazo;
  s.foraDoPrazo += l.foraDoPrazo;
  s.semResposta += l.semResposta;
  s.pedidos += l.pedidos;
  s.pedidosPagos += l.pedidosPagos;
  s.vendido += l.vendido;
  try {
    const h = JSON.parse(l.hist) as number[];
    h.forEach((n, i) => (s.hist[i] = (s.hist[i] ?? 0) + (n || 0)));
  } catch {
    /* linha torta não derruba o painel */
  }
}

/** os derivados: % no prazo das decididas, ticket, arredondamento e a mediana pelos baldes */
function derivar(s: SomaComum): void {
  const decididas = s.noPrazo + s.foraDoPrazo;
  s.pctNoPrazo = decididas ? Math.round((s.noPrazo / decididas) * 100) : null;
  s.ticket = s.pedidosPagos ? Math.round((s.vendido / s.pedidosPagos) * 100) / 100 : null;
  s.vendido = Math.round(s.vendido * 100) / 100;
  s.medianaAproxMin = medianaDaDistribuicao(s.hist);
}

/** Soma as linhas de um período (pura). */
export function somarDias(linhas: LinhaDia[]): SomaDoPeriodo {
  const s: SomaDoPeriodo = { ...somaVazia(), esperas: 0, origens: {}, diasComFato: linhas.length };
  for (const l of linhas) {
    acumular(s, l);
    s.esperas += l.esperas;
    try {
      const o = JSON.parse(l.origens) as Record<string, number>;
      for (const [k, v] of Object.entries(o)) s.origens[k] = (s.origens[k] ?? 0) + v;
    } catch {
      /* idem */
    }
  }
  derivar(s);
  return s;
}

/** O teto do balde em que a metade acumulada cai (nulo sem respondidas). */
export function medianaDaDistribuicao(hist: number[]): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let acumulado = 0;
  for (let i = 0; i < hist.length; i++) {
    acumulado += hist[i];
    if (acumulado * 2 >= total) return i < BALDES_MIN.length ? BALDES_MIN[i] : Infinity;
  }
  return null;
}

export type RealizadoDoMes = Record<TipoDeMeta, number | null>;

export type Painel = {
  periodo: Periodo;
  anterior: Periodo;
  atual: SomaDoPeriodo;
  passado: SomaDoPeriodo;
  /** por dia, na ordem do período (dias sem fato vêm zerados) */
  serie: { dia: string; leads: number; vendido: number; pedidosPagos: number; pctNoPrazo: number | null }[];
  hoje: { leads: number; vendido: number; pedidosPagos: number; esperandoAgora: number };
  funil: { leads: number; respondidos: number; comPedido: number; pagaram: number };
  motivos: { label: string; value: number; sub?: string }[];
  mes: string;
  realizado: RealizadoDoMes;
  metas: Partial<Record<TipoDeMeta, number>>;
  recompraPct: number | null;
  atualizadoEm: Date | null;
  /** quantos dias do período ainda não têm fato gravado (histórico sendo preenchido) */
  diasSemFato: number;
};

const PAGOS = [...PAID_ORDER_STATUSES];

export async function montarPainel(companyId: string, pedido: Periodo, agora = new Date()): Promise<Painel> {
  const periodo = encaixarPeriodo(pedido);
  const dias = diasDoPeriodo(periodo);
  const anterior = periodoAnterior(periodo);
  const hoje = diaSP(agora);
  const mes = mesSP(agora);
  const inicioMes = inicioDoMesSP(agora);
  const inicioPeriodo = inicioDoDiaSP(periodo.de);
  const fimPeriodo = new Date(inicioDoDiaSP(periodo.ate).getTime() + 86_400_000);

  const [linhasAtual, linhasPassado, linhasMes, linhaHoje, esperandoRaw, vendasMes, compradoras, perdidas, metasMes, novosNoMes] =
    await Promise.all([
      db.biDia.findMany({ where: { companyId, dia: { gte: periodo.de, lte: periodo.ate } }, orderBy: { dia: "asc" } }),
      db.biDia.findMany({ where: { companyId, dia: { gte: anterior.de, lte: anterior.ate } } }),
      db.biDia.findMany({ where: { companyId, dia: { gte: mes + "-01", lte: hoje } } }),
      db.biDia.findUnique({ where: { companyId_dia: { companyId, dia: hoje } } }),
      // quem está esperando AGORA: a última fala é da cliente, conversa não
      // encerrada — UMA contagem no banco (duas colunas comparadas, que o
      // Prisma não escreve; carregar as conversas para contar não escala)
      db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n FROM "Conversation"
        WHERE "companyId" = ${companyId}
          AND "status" <> 'CLOSED'
          AND "lastInboundAt" IS NOT NULL
          AND "lastInboundAt" > COALESCE("lastOutboundAt", '-infinity'::timestamp)
      `,
      db.order.aggregate({
        where: { companyId, status: { in: PAGOS }, paidAt: { gte: inicioMes } },
        _sum: { netTotal: true },
        _count: true,
      }),
      // recompra: clientes com 2+ pedidos pagos entre quem já pagou — pedido pago
      // COM data de pagamento, a régua da carteira da Recompra (RN-084): as duas
      // abas do BI dizem o mesmo número (achado da revisão; o pago sem data é
      // só o pedido antigo, e o Dashboard ainda o conta)
      db.order.groupBy({ by: ["customerId"], where: { companyId, status: { in: PAGOS }, paidAt: { not: null } }, _count: true }),
      db.opportunity.findMany({
        where: { companyId, status: "LOST", closedAt: { gte: inicioPeriodo, lt: fimPeriodo } },
        select: { lostReason: true },
      }),
      db.biMeta.findMany({ where: { companyId, mes } }),
      db.customer.count({ where: { companyId, createdAt: { gte: inicioMes } } }),
    ]);

  const atual = somarDias(linhasAtual);
  const passado = somarDias(linhasPassado);
  const doMes = somarDias(linhasMes);
  const porDia = new Map(linhasAtual.map((l) => [l.dia, l]));
  const serie = dias.map((dia) => {
    const l = porDia.get(dia);
    const decididas = l ? l.noPrazo + l.foraDoPrazo : 0;
    return {
      dia,
      leads: l?.leads ?? 0,
      vendido: l?.vendido ?? 0,
      pedidosPagos: l?.pedidosPagos ?? 0,
      pctNoPrazo: l && decididas ? Math.round((l.noPrazo / decididas) * 100) : null,
    };
  });

  const esperandoAgora = Number(esperandoRaw[0]?.n ?? 0);
  const compradorasTotal = compradoras.length;
  const recompraPct = compradorasTotal
    ? Math.round((compradoras.filter((c) => c._count >= 2).length / compradorasTotal) * 100)
    : null;
  const vendidoMes = Math.round((vendasMes._sum.netTotal ?? 0) * 100) / 100;
  const realizado: RealizadoDoMes = {
    FATURAMENTO: vendidoMes,
    PEDIDOS_PAGOS: vendasMes._count,
    NOVOS_CONTATOS: novosNoMes,
    RESPOSTA_NO_PRAZO_PCT: doMes.pctNoPrazo,
    TICKET_MEDIO: vendasMes._count ? Math.round((vendidoMes / vendasMes._count) * 100) / 100 : null,
    RECOMPRA_PCT: recompraPct,
  };
  const metas: Partial<Record<TipoDeMeta, number>> = {};
  for (const m of metasMes) {
    if ((TIPOS_DE_META as readonly { tipo: string }[]).some((t) => t.tipo === m.tipo)) metas[m.tipo as TipoDeMeta] = m.valor;
  }
  const atualizadoEm = linhasAtual.reduce<Date | null>(
    (max, l) => (!max || l.atualizadoEm > max ? l.atualizadoEm : max),
    null
  );

  return {
    periodo,
    anterior,
    atual,
    passado,
    serie,
    hoje: {
      leads: linhaHoje?.leads ?? 0,
      vendido: linhaHoje?.vendido ?? 0,
      pedidosPagos: linhaHoje?.pedidosPagos ?? 0,
      esperandoAgora,
    },
    // o funil inteiro vem dos FATOS (uma fonte só; barra de baixo nunca passa a de cima)
    funil: {
      leads: atual.leads,
      respondidos: atual.leadsRespondidos,
      comPedido: atual.leadsComPedido,
      pagaram: atual.leadsPagaram,
    },
    motivos: contarPorMotivo(perdidas),
    mes,
    realizado,
    metas,
    recompraPct,
    atualizadoEm,
    diasSemFato: Math.max(0, dias.length - linhasAtual.length),
  };
}

/* ───────────────────────── POR VENDEDORA (RN-083) ───────────────────────── */

/** a linha do banco, pelo tipo do Prisma: coluna nova chega aqui sem cópia à mão */
type LinhaVendedora = Pick<BiDiaVendedora, keyof LinhaComum | "userId">;

export type SomaDaVendedora = SomaComum & {
  userId: string;
  nome: string;
  cor: string;
  ativa: boolean;
  /** leads da carteira que pagaram ÷ leads (nulo sem lead) */
  conversaoPct: number | null;
};

export type Vendedoras = {
  periodo: Periodo;
  /** quem teve algum número no período, do maior vendido para o menor */
  pessoas: SomaDaVendedora[];
  /** o total da loja (a mesma soma do painel) — a régua do "sem vendedora" */
  loja: SomaDoPeriodo;
  /**
   * O que sobra entre a loja e a soma das pessoas: respostas pelo celular da
   * loja (eco sem autora), leads sem dona (da loja, RN-005), vendas sem
   * vendedora (loja online, pedido sem dona) e esperas abertas na fila.
   */
  semVendedora: { respondidas: number; leads: number; pedidosPagos: number; vendido: number; semResposta: number };
  /**
   * Dias do período cujo fato da loja foi gravado ANTES de existirem as linhas
   * por vendedora (versão velha): o número deles está na loja e ainda não nas
   * pessoas — a aba DIZ, em vez de deixar cair em "sem vendedora".
   */
  diasSemVendedoras: number;
};

/** Soma as linhas de uma pessoa (pura). */
export function somarVendedora(
  pessoa: { id: string; name: string; color: string; active: boolean },
  linhas: LinhaVendedora[]
): SomaDaVendedora {
  const s: SomaDaVendedora = {
    ...somaVazia(),
    userId: pessoa.id,
    nome: pessoa.name,
    cor: pessoa.color,
    ativa: pessoa.active,
    conversaoPct: null,
  };
  for (const l of linhas) acumular(s, l);
  // na pessoa, decididas = só as que ELA respondeu (a aberta é "sem resposta", RN-083)
  derivar(s);
  s.conversaoPct = s.leads ? Math.round((s.leadsPagaram / s.leads) * 100) : null;
  return s;
}

/** A pessoa teve algum número no período? (quem não teve não vira linha na aba) */
export function teveNumero(s: SomaDaVendedora): boolean {
  return s.leads + s.respondidas + s.semResposta + s.pedidos + s.pedidosPagos > 0;
}

/** Ordena do maior vendido para o menor; empate pelo que respondeu, depois pelo nome. */
export function ordenarVendedoras(pessoas: SomaDaVendedora[]): SomaDaVendedora[] {
  return [...pessoas].sort(
    (a, b) => b.vendido - a.vendido || b.respondidas - a.respondidas || a.nome.localeCompare(b.nome, "pt-BR")
  );
}

export async function montarVendedoras(companyId: string, pedido: Periodo): Promise<Vendedoras> {
  const periodo = encaixarPeriodo(pedido);
  const [linhas, linhasDaLoja, pessoas] = await Promise.all([
    db.biDiaVendedora.findMany({ where: { companyId, dia: { gte: periodo.de, lte: periodo.ate } } }),
    db.biDia.findMany({ where: { companyId, dia: { gte: periodo.de, lte: periodo.ate } } }),
    db.user.findMany({ where: { companyId }, select: { id: true, name: true, color: true, active: true } }),
  ]);
  const porPessoa = new Map<string, LinhaVendedora[]>();
  for (const l of linhas) {
    let lista = porPessoa.get(l.userId);
    if (!lista) porPessoa.set(l.userId, (lista = []));
    lista.push(l);
  }
  const somas = ordenarVendedoras(
    pessoas.map((p) => somarVendedora(p, porPessoa.get(p.id) ?? [])).filter(teveNumero)
  );
  const loja = somarDias(linhasDaLoja);
  const soma = (k: "respondidas" | "leads" | "pedidosPagos" | "vendido" | "semResposta") =>
    somas.reduce((a, s) => a + s[k], 0);
  return {
    periodo,
    pessoas: somas,
    loja,
    semVendedora: {
      respondidas: Math.max(0, loja.respondidas - soma("respondidas")),
      leads: Math.max(0, loja.leads - soma("leads")),
      pedidosPagos: Math.max(0, loja.pedidosPagos - soma("pedidosPagos")),
      vendido: Math.max(0, Math.round((loja.vendido - soma("vendido")) * 100) / 100),
      semResposta: Math.max(0, loja.semResposta - soma("semResposta")),
    },
    diasSemVendedoras: linhasDaLoja.filter((l) => l.versao < VERSAO_DOS_FATOS).length,
  };
}
