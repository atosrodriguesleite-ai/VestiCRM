/**
 * A CARTEIRA NO BI — a leitura RFM (RN-084, ADR-019).
 *
 * REGRA DE OURO (a mesma do painel de Recompra): esta aba NÃO faz conta
 * própria de quem é cliente, em que estágio está nem quem é VIP. Tudo vem
 * de `dadosDaAbaRecompra` — a faixa pela última compra (`faixaFixa`), o
 * ritmo de cada cliente (`cicloEntreCompras`/`passouDoRitmo`), o Top 20
 * VIP, o total comprado. Se o BI dissesse "40 clientes ativas" e a aba
 * Recompra "38", a loja pararia de confiar nas duas.
 *
 * O que o BI ACRESCENTA é a leitura cruzada que faltava:
 * - R × F: a faixa (recência) cruzada com a frequência (quantas compras) —
 *   a cliente que comprou UMA vez e sumiu é a classe mais comum e a mais
 *   barata de recuperar; a recorrente que esfriou é a mais cara de perder;
 * - M: quanto cada célula vale (total e o valor médio por compra);
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

/** as faixas de FREQUÊNCIA (quantas compras pagas na vida) */
export type Frequencia = "UMA" | "POUCAS" | "FIEL";
export const FREQUENCIAS: { id: Frequencia; rotulo: string; de: number; ate: number | null }[] = [
  { id: "UMA", rotulo: "1 compra", de: 1, ate: 1 },
  { id: "POUCAS", rotulo: "2 a 4 compras", de: 2, ate: 4 },
  { id: "FIEL", rotulo: "5 ou mais", de: 5, ate: null },
];

export function frequenciaDe(compras: number): Frequencia {
  if (compras >= 5) return "FIEL";
  if (compras >= 2) return "POUCAS";
  return "UMA";
}

export type Celula = { clientes: number; total: number; mediaPorCompra: number | null };

export type MatrizRfm = Record<Faixa, Record<Frequencia, Celula>>;

function celulaVazia(): Celula {
  return { clientes: 0, total: 0, mediaPorCompra: null };
}

/** R × F, com o M em cada célula (pura). */
export function matrizRfm(clientes: Pick<ClienteDeRecompra, "faixa" | "compras" | "total">[]): MatrizRfm {
  const m = {} as MatrizRfm;
  const compras = new Map<Celula, number>();
  for (const f of FAIXAS) {
    m[f.id] = { UMA: celulaVazia(), POUCAS: celulaVazia(), FIEL: celulaVazia() };
  }
  for (const c of clientes) {
    const cel = m[c.faixa][frequenciaDe(c.compras)];
    cel.clientes += 1;
    cel.total += c.total;
    compras.set(cel, (compras.get(cel) ?? 0) + c.compras);
  }
  for (const [cel, n] of compras) {
    cel.total = r2(cel.total);
    cel.mediaPorCompra = n ? r2(cel.total / n) : null;
  }
  return m;
}

/** o total de uma linha da matriz = a soma das células JÁ arredondadas (o centavo fecha, RN-030) */
export function totalDaFaixa(m: MatrizRfm, faixa: Faixa): number {
  return r2(FREQUENCIAS.reduce((s, q) => s + m[faixa][q.id].total, 0));
}

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
  matriz: MatrizRfm;
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
    matriz: matrizRfm(aba.clientes),
    melhoresDoPeriodo,
    vendidoNoPeriodo: r2(vendas._sum.netTotal ?? 0),
  };
}
