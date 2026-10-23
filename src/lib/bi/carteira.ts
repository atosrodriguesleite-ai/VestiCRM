/**
 * A CARTEIRA NO BI (RN-084, ADR-019) — e, ao lado dela, o RFM (RN-092, em
 * `rfm-regra.ts`/`rfm.ts`), que substituiu a antiga matriz faixa × compras.
 *
 * REGRA DE OURO (a mesma do painel de Recompra): esta aba NÃO faz conta
 * própria de quem é cliente, em que estágio está nem quem é VIP. Tudo vem
 * de `dadosDaAbaRecompra` — a faixa pela última compra (`faixaFixa`), o
 * ritmo de cada cliente (`cicloEntreCompras`/`passouDoRitmo`), o Top 20
 * VIP, o total comprado. Se o BI dissesse "40 clientes ativas" e a aba
 * Recompra "38", a loja pararia de confiar nas duas.
 *
 * O que o BI ACRESCENTA aqui:
 * - as VIPs que esfriaram — o alarme de verdade da carteira;
 * - as melhores clientes DO PERÍODO escolhido (pela data do pagamento,
 *   `netTotal` — RN-001/RN-002), que a aba Recompra não responde (ela olha
 *   a vida inteira).
 */
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import type { SessionUser } from "../auth";
import { dadosDaAbaRecompra, type ClienteDeRecompra } from "../recompra";
import { FAIXAS, type Faixa } from "../recompra-textos";
import { r2 } from "../tracking/insights-puro";
import { encaixarPeriodo, type Periodo } from "./painel";
import { inicioDoDiaSP } from "./fatos";

export { FAIXAS };
export type { Faixa };

export type ResumoDaCarteira = {
  compradoras: number;
  recorrentes: number;
  /** recorrentes ÷ compradoras — a MESMA conta do painel de Recompra e do Dashboard */
  taxaRecompraPct: number | null;
  porFaixa: Record<Faixa, { clientes: number }>;
  /** quem passou do próprio ritmo (a régua da agenda de recompra) */
  passouDoPonto: number;
  /** a compra média de cada atrasada — o que está na mesa */
  valorEmRisco: number;
  /** % do total histórico comprado pelas VIPs (Top 20) */
  concentracaoVipPct: number | null;
  /** VIPs fora da faixa Ativa, da maior para a menor — o alarme da carteira */
  vipsEsfriando: ClienteDeRecompra[];
};

/** Os números da carteira, derivados da lista da aba Recompra (pura). */
export function resumirCarteira(clientes: ClienteDeRecompra[]): ResumoDaCarteira {
  const porFaixa = {} as ResumoDaCarteira["porFaixa"];
  for (const f of FAIXAS) porFaixa[f.id] = { clientes: 0 };
  let totalHistorico = 0;
  let totalVip = 0;
  for (const c of clientes) {
    porFaixa[c.faixa].clientes += 1;
    totalHistorico += c.total;
    if (c.vip !== null) totalVip += c.total;
  }
  const recorrentes = clientes.filter((c) => c.compras >= 2).length;
  const atrasadas = clientes.filter((c) => c.passouDoPonto);
  return {
    compradoras: clientes.length,
    recorrentes,
    taxaRecompraPct: clientes.length ? Math.round((recorrentes / clientes.length) * 100) : null,
    porFaixa,
    passouDoPonto: atrasadas.length,
    valorEmRisco: r2(atrasadas.reduce((s, c) => s + c.total / c.compras, 0)),
    concentracaoVipPct: totalHistorico ? Math.round((totalVip / totalHistorico) * 100) : null,
    vipsEsfriando: clientes
      .filter((c) => c.vip !== null && c.faixa !== "ATIVA")
      .sort((a, b) => (a.vip ?? 99) - (b.vip ?? 99)),
  };
}

export type MelhorDoPeriodo = {
  id: string;
  nome: string;
  pedidos: number;
  total: number;
  /** a faixa de HOJE da cliente (da carteira) */
  faixa: Faixa;
  vip: number | null;
};

export type Carteira = {
  periodo: Periodo;
  resumo: ResumoDaCarteira;
  /** as 20 que mais compraram NO PERÍODO (pagamento no período, netTotal) */
  melhoresDoPeriodo: MelhorDoPeriodo[];
  vendidoNoPeriodo: number;
};

export const TOP_DO_PERIODO = 20;
const PAGOS = [...PAID_ORDER_STATUSES];

/** Monta a aba: a carteira (fonte única da Recompra) + as melhores do período (BI). */
export async function montarCarteira(user: SessionUser, pedido: Periodo): Promise<Carteira> {
  const periodo = encaixarPeriodo(pedido);
  const inicio = inicioDoDiaSP(periodo.de);
  const fim = new Date(inicioDoDiaSP(periodo.ate).getTime() + 86_400_000);
  const [aba, porCliente, vendas] = await Promise.all([
    // a leitura LEVE: a mesma carteira, sem os itens dos pedidos (o BI não usa)
    dadosDaAbaRecompra(user, { leve: true }),
    db.order.groupBy({
      by: ["customerId"],
      where: { companyId: user.companyId, status: { in: PAGOS }, paidAt: { gte: inicio, lt: fim } },
      _sum: { netTotal: true },
      _count: true,
      orderBy: { _sum: { netTotal: "desc" } },
      take: TOP_DO_PERIODO,
    }),
    db.order.aggregate({
      where: { companyId: user.companyId, status: { in: PAGOS }, paidAt: { gte: inicio, lt: fim } },
      _sum: { netTotal: true },
    }),
  ]);
  // quem pagou no período tem pedido pago com data, logo está na carteira
  // (gerência vê a loja inteira, RN-013 pelo `ownedScope`): o nome vem de lá,
  // sem uma quarta ida ao banco. Quem não estiver (pedido pago de cliente
  // apagada no meio) fica fora da lista, nunca sem nome.
  const daCarteira = new Map(aba.clientes.map((c) => [c.id, c]));
  const melhoresDoPeriodo: MelhorDoPeriodo[] = [];
  for (const p of porCliente) {
    const c = p.customerId ? daCarteira.get(p.customerId) : undefined;
    if (!c) continue;
    melhoresDoPeriodo.push({
      id: c.id,
      nome: c.name,
      pedidos: p._count,
      total: r2(p._sum.netTotal ?? 0),
      faixa: c.faixa,
      vip: c.vip,
    });
  }
  return {
    periodo,
    resumo: resumirCarteira(aba.clientes),
    melhoresDoPeriodo,
    vendidoNoPeriodo: r2(vendas._sum.netTotal ?? 0),
  };
}
