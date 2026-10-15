/**
 * ROI DE ANÚNCIO (RN-085, ADR-019) — a aba Anúncios do BI.
 *
 * A pergunta do dono: "de qual anúncio o lead vem, e o que cada real
 * investido trouxe". A atribuição já existe e é automática (RN-015: o
 * anúncio Click-to-WhatsApp vira `Customer.campaignId` numa
 * `MarketingCampaign`; sem marcação manual — decisão do dono). O que
 * FALTAVA era o gasto POR MÊS: a tela Marketing guarda o investimento de
 * TODA A VIDA e compara com o faturamento de toda a vida — uma conta
 * verdadeira, mas que não responde "outubro valeu a pena?".
 *
 * Aqui as duas pontas ficam na MESMA régua, a do período da tela:
 * - GASTO: a soma dos meses que o período toca (`BiGastoDeAnuncio`,
 *   digitado pela gerência na própria aba). Mês inteiro, de propósito: um
 *   período de 1 a 15 usa o gasto de outubro inteiro — ratear por dia seria
 *   precisão de mentira (a loja não gasta igual todo dia), e a tela diz;
 * - CONTATOS NOVOS: as clientes cadastradas no período com a campanha
 *   atribuída (a coorte);
 * - PAGARAM: dessas, quantas já têm pedido pago (qualquer data — a cliente
 *   que chegou dia 28 e pagou dia 3 conta para o anúncio que a trouxe);
 * - VENDIDO: o que entrou no período de QUALQUER cliente da campanha (pedido
 *   pago pela data do pagamento, `netTotal` — RN-001/RN-002). É caixa, não
 *   coorte: o anúncio de março que ainda traz recompra em outubro aparece
 *   em outubro — e a tela diz que são duas perguntas.
 * Daí: CAC = gasto ÷ contatos novos; custo por venda = gasto ÷ pagaram;
 * retorno = vendido ÷ gasto. Sem base, nulo — nunca zero disfarçado.
 */
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import { r2 } from "../tracking/insights-puro";
export { rotuloDoCanal } from "../canais-de-anuncio";
import { encaixarPeriodo, type Periodo } from "./painel";
import { inicioDoDiaSP } from "./fatos";

/** teto do gasto num mês (dedo errado acima disso) */
export const TETO_DO_GASTO = 99_999_999;

/** os meses "AAAA-MM" que um período toca, do mais antigo ao mais novo (puro) */
export function mesesDoPeriodo(p: Periodo): string[] {
  const de = p.de.slice(0, 7);
  const ate = p.ate.slice(0, 7);
  if (de > ate) return [];
  const out: string[] = [];
  let [ano, mes] = de.split("-").map(Number);
  for (let i = 0; i < 14; i++) {
    const m = `${ano}-${String(mes).padStart(2, "0")}`;
    out.push(m);
    if (m === ate) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return out;
}

export type Retorno = {
  cac: number | null;
  custoPorVenda: number | null;
  retorno: number | null;
  conversaoPct: number | null;
};

/** as três contas, nulas sem base (pura) */
export function calcularRetorno(n: { gasto: number; leads: number; pagaram: number; vendido: number }): Retorno {
  return {
    cac: n.gasto > 0 && n.leads > 0 ? r2(n.gasto / n.leads) : null,
    custoPorVenda: n.gasto > 0 && n.pagaram > 0 ? r2(n.gasto / n.pagaram) : null,
    retorno: n.gasto > 0 ? r2(n.vendido / n.gasto) : null,
    conversaoPct: n.leads > 0 ? Math.round((n.pagaram / n.leads) * 100) : null,
  };
}

export type CampanhaLeve = { id: string; name: string; channel: string; active: boolean };

export type LinhaDeAnuncio = Retorno & {
  id: string;
  nome: string;
  canal: string;
  ativa: boolean;
  gasto: number;
  leads: number;
  pagaram: number;
  vendido: number;
};

/**
 * Uma linha por campanha que teve algum número no período (gasto, contato
 * ou venda); campanha parada com número aparece marcada. Ordem: vendido,
 * depois gasto, depois nome. Puro.
 */
export function montarLinhas(
  campanhas: CampanhaLeve[],
  numeros: Map<string, { gasto?: number; leads?: number; pagaram?: number; vendido?: number }>
): LinhaDeAnuncio[] {
  const linhas: LinhaDeAnuncio[] = [];
  for (const c of campanhas) {
    const n = numeros.get(c.id);
    const gasto = r2(n?.gasto ?? 0);
    const leads = n?.leads ?? 0;
    const pagaram = n?.pagaram ?? 0;
    const vendido = r2(n?.vendido ?? 0);
    if (gasto + leads + vendido === 0) continue;
    linhas.push({
      id: c.id,
      nome: c.name,
      canal: c.channel,
      ativa: c.active,
      gasto,
      leads,
      pagaram,
      vendido,
      ...calcularRetorno({ gasto, leads, pagaram, vendido }),
    });
  }
  return linhas.sort((a, b) => b.vendido - a.vendido || b.gasto - a.gasto || a.nome.localeCompare(b.nome, "pt-BR"));
}

export type Totais = Retorno & { gasto: number; leads: number; pagaram: number; vendido: number };

/** a linha de baixo: soma das linhas e as contas sobre a soma (pura) */
export function somarLinhas(linhas: LinhaDeAnuncio[]): Totais {
  const t = { gasto: 0, leads: 0, pagaram: 0, vendido: 0 };
  for (const l of linhas) {
    t.gasto += l.gasto;
    t.leads += l.leads;
    t.pagaram += l.pagaram;
    t.vendido += l.vendido;
  }
  t.gasto = r2(t.gasto);
  t.vendido = r2(t.vendido);
  return { ...t, ...calcularRetorno(t) };
}

export type Anuncios = {
  periodo: Periodo;
  meses: string[];
  linhas: LinhaDeAnuncio[];
  totais: Totais;
  /** contatos novos do período SEM anúncio identificado (chegaram por outro caminho) */
  semAnuncio: number;
  /** para o editor: toda campanha da loja, ativa primeiro */
  campanhas: CampanhaLeve[];
  /** para o editor: o gasto gravado, campanha × mês */
  gastos: { campanhaId: string; mes: string; valor: number }[];
};

const PAGOS = [...PAID_ORDER_STATUSES];
const LOTE = 5_000;

export async function montarAnuncios(companyId: string, pedido: Periodo): Promise<Anuncios> {
  const periodo = encaixarPeriodo(pedido);
  const meses = mesesDoPeriodo(periodo);
  const inicio = inicioDoDiaSP(periodo.de);
  const fim = new Date(inicioDoDiaSP(periodo.ate).getTime() + 86_400_000);
  // TUDO RECORTADO PELO PERÍODO (achado da revisão): a loja madura tem dezenas
  // de milhares de clientes atribuídas e a aba não pode carregá-las inteiras
  // — a coorte são só as que chegaram no período, e o caixa é AGREGADO no
  // banco (uma linha por cliente que pagou, não por pedido)
  const [campanhas, gastos, coorte, quemPagouNoPeriodo, semAnuncio] = await Promise.all([
    db.marketingCampaign.findMany({
      where: { companyId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, channel: true, active: true },
    }),
    db.biGastoDeAnuncio.findMany({
      where: { companyId, mes: { in: meses } },
      select: { campanhaId: true, mes: true, valor: true },
    }),
    // a coorte: quem chegou NO PERÍODO com campanha (a atribuição automática, RN-015)
    db.customer.findMany({
      where: { companyId, campaignId: { not: null }, createdAt: { gte: inicio, lt: fim } },
      select: { id: true, campaignId: true },
    }),
    // o caixa: o que entrou no período das clientes de campanha (RN-001/RN-002)
    db.order.groupBy({
      by: ["customerId"],
      where: { companyId, status: { in: PAGOS }, paidAt: { gte: inicio, lt: fim }, customer: { campaignId: { not: null } } },
      _sum: { netTotal: true },
    }),
    db.customer.count({ where: { companyId, campaignId: null, createdAt: { gte: inicio, lt: fim } } }),
  ]);

  const numeros = new Map<string, { gasto: number; leads: number; pagaram: number; vendido: number }>();
  const pega = (id: string) => {
    let n = numeros.get(id);
    if (!n) numeros.set(id, (n = { gasto: 0, leads: 0, pagaram: 0, vendido: 0 }));
    return n;
  };
  for (const g of gastos) pega(g.campanhaId).gasto += g.valor;

  // a campanha de cada cliente: a coorte já diz; quem pagou no período e não
  // é da coorte (chegou antes) é buscada em lotes, só ela
  const campanhaDe = new Map(coorte.map((c) => [c.id, c.campaignId!]));
  const idsQuePagaram = quemPagouNoPeriodo.map((g) => g.customerId).filter((id): id is string => !!id);
  const faltam = idsQuePagaram.filter((id) => !campanhaDe.has(id));
  for (let i = 0; i < faltam.length; i += LOTE) {
    const achadas = await db.customer.findMany({
      where: { companyId, id: { in: faltam.slice(i, i + LOTE) } },
      select: { id: true, campaignId: true },
    });
    for (const c of achadas) if (c.campaignId) campanhaDe.set(c.id, c.campaignId);
  }
  for (const c of coorte) pega(c.campaignId!).leads += 1;
  for (const g of quemPagouNoPeriodo) {
    const id = g.customerId && campanhaDe.get(g.customerId);
    if (id) pega(id).vendido += g._sum.netTotal ?? 0;
  }
  // da coorte, quem já pagou (qualquer data): em lotes de ids
  const pagaram = new Set<string>();
  for (let i = 0; i < coorte.length; i += LOTE) {
    const ids = coorte.slice(i, i + LOTE).map((c) => c.id);
    const grupos = await db.order.groupBy({
      by: ["customerId"],
      where: { companyId, status: { in: PAGOS }, paidAt: { not: null }, customerId: { in: ids } },
      _count: true,
    });
    for (const g of grupos) if (g.customerId) pagaram.add(g.customerId);
  }
  for (const c of coorte) if (pagaram.has(c.id)) pega(c.campaignId!).pagaram += 1;

  const linhas = montarLinhas(campanhas, numeros);
  return { periodo, meses, linhas, totais: somarLinhas(linhas), semAnuncio, campanhas, gastos };
}
