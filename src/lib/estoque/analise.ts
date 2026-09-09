import { Prisma } from "@prisma/client";
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import { linhasDoEstoque, type LinhaDoInventario } from "./inventario";
import { noMinimo } from "./minimos";

/**
 * ANÁLISE DE ESTOQUE POR REGRA (RN-052) — sem IA, de propósito.
 *
 * O dono pediu "análise de estoque inteligente"; alinhado com ele
 * (09/09/2026): inteligente aqui é REGRA CLARA que a lojista entende e
 * confere, não palpite. Quatro perguntas, cada uma com a conta dita:
 *
 *  • GIRO: quantas peças desta variação saíram nos últimos 30 dias — só
 *    PEDIDO PAGO (RN-001), pela quantidade do item. Orçamento não é venda.
 *  • COBERTURA: para quantos dias o disponível dá, no ritmo dos 30 dias
 *    (disponível ÷ vendas por dia). Sem venda no período, não há cobertura
 *    — a tela diz "sem venda", nunca "infinito".
 *  • ENCALHADA: tem peça na loja e NÃO vendeu nada em 60 dias (ou nunca).
 *    O valor parado é a CUSTO (`Product.costPrice`) — é o dinheiro que a
 *    loja gastou e está na arara; a atacado seria dinheiro que ela ainda
 *    não recebeu.
 *  • O QUE REPOR: chegou ao mínimo (RN-051). A sugestão de quantidade cobre
 *    30 dias de venda no ritmo atual, e nunca menos que voltar ao DOBRO do
 *    mínimo — repor só até o mínimo faria a peça alertar de novo na primeira
 *    venda.
 */

export const DIAS_DO_GIRO = 30;
export const DIAS_PARA_ENCALHAR = 60;

export type VendaDaVariacao = { vendidos30: number; ultimaVendaEm: Date | null };

/** Vendas dos últimos N dias e última venda de cada variação (pedido pago). */
export async function vendasPorVariacao(
  companyId: string,
  agora = new Date()
): Promise<Map<string, VendaDaVariacao>> {
  const desde = new Date(agora.getTime() - DIAS_DO_GIRO * 86_400_000);
  const rows = await db.$queryRaw<
    { variantId: string; vendidos30: number; ultimaVendaEm: Date | null }[]
  >(Prisma.sql`
    SELECT i."variantId",
           COALESCE(SUM(CASE WHEN COALESCE(o."paidAt", o."createdAt") >= ${desde} THEN i."quantity" ELSE 0 END), 0)::int AS "vendidos30",
           MAX(COALESCE(o."paidAt", o."createdAt")) AS "ultimaVendaEm"
      FROM "OrderItem" i
      JOIN "Order" o ON o."id" = i."orderId"
     WHERE o."companyId" = ${companyId}
       AND i."variantId" IS NOT NULL
       AND o."status"::text IN (${Prisma.join([...PAID_ORDER_STATUSES])})
     GROUP BY i."variantId"
  `);
  return new Map(rows.map((r) => [r.variantId, { vendidos30: r.vendidos30, ultimaVendaEm: r.ultimaVendaEm }]));
}

export type Situacao = "REPOR" | "ENCALHADA" | "OK" | "SEM_VENDA" | "ZERADA";

export type AnaliseDaPeca = {
  /** peças por dia nos últimos 30 dias */
  giroDia: number;
  vendidos30: number;
  /** dias que o disponível cobre no ritmo atual; null = sem venda no período */
  coberturaDias: number | null;
  diasSemVenda: number | null;
  encalhada: boolean;
  /** R$ parado a custo (disponível + reservado × custo) */
  valorParadoCusto: number;
  /** quantas peças repor (0 = não precisa) */
  repor: number;
  situacao: Situacao;
};

/** A conta de UMA variação (pura, testável). */
export function analisarPeca(
  l: Pick<LinhaDoInventario, "disponivel" | "emEstoque" | "minimo" | "custo">,
  venda: VendaDaVariacao | undefined,
  agora: Date
): AnaliseDaPeca {
  const vendidos30 = venda?.vendidos30 ?? 0;
  const giroDia = vendidos30 / DIAS_DO_GIRO;
  const coberturaDias = giroDia > 0 ? Math.floor(l.disponivel / giroDia) : null;
  const diasSemVenda = venda?.ultimaVendaEm
    ? Math.floor((agora.getTime() - venda.ultimaVendaEm.getTime()) / 86_400_000)
    : null;
  const temPeca = l.emEstoque > 0;
  const encalhada = temPeca && (diasSemVenda === null || diasSemVenda >= DIAS_PARA_ENCALHAR);
  const valorParadoCusto = l.emEstoque * l.custo;
  const chegouAoMinimo = noMinimo(l.disponivel, l.minimo);
  const repor = chegouAoMinimo
    ? Math.max(Math.ceil(giroDia * DIAS_DO_GIRO), l.minimo * 2) - l.disponivel
    : 0;
  let situacao: Situacao = "OK";
  if (l.disponivel === 0) situacao = "ZERADA";
  else if (chegouAoMinimo) situacao = "REPOR";
  else if (encalhada) situacao = "ENCALHADA";
  else if (vendidos30 === 0) situacao = "SEM_VENDA";
  return {
    giroDia,
    vendidos30,
    coberturaDias,
    diasSemVenda,
    encalhada,
    valorParadoCusto,
    repor: Math.max(0, repor),
    situacao,
  };
}

export type LinhaAnalisada = LinhaDoInventario & { analise: AnaliseDaPeca };

export type Painel = {
  totais: {
    pecas: number;
    disponiveis: number;
    reservadas: number;
    valorCusto: number;
    valorAtacado: number;
    variacoes: number;
    noMinimo: number;
    zeradas: number;
    encalhadas: number;
    valorEncalhadoCusto: number;
    vendidos30: number;
    /** % das peças em estoque que vendeu nos 30 dias (vendidos ÷ (estoque + vendidos)) */
    giroPct: number;
  };
  repor: LinhaAnalisada[];
  encalhadas: LinhaAnalisada[];
  maisVendidas: LinhaAnalisada[];
  porCategoria: {
    categoria: string;
    pecas: number;
    valorCusto: number;
    vendidos30: number;
    noMinimo: number;
    encalhadas: number;
  }[];
  diasDoGiro: number;
  diasParaEncalhar: number;
};

export const TETO_DAS_LISTAS = 30;

/** O painel do setor: totais, o que repor, o que encalhou, o que mais vende. */
export async function montarPainel(companyId: string, agora = new Date()): Promise<Painel> {
  const [{ linhas }, vendas] = await Promise.all([
    linhasDoEstoque(companyId),
    vendasPorVariacao(companyId, agora),
  ]);
  const analisadas: LinhaAnalisada[] = linhas.map((l) => ({
    ...l,
    analise: analisarPeca(l, vendas.get(l.variantId), agora),
  }));

  const soma = (f: (l: LinhaAnalisada) => number) => analisadas.reduce((s, l) => s + f(l), 0);
  const vendidos30 = soma((l) => l.analise.vendidos30);
  const pecas = soma((l) => l.emEstoque);
  const encalhadas = analisadas.filter((l) => l.analise.encalhada);

  const porCat = new Map<string, Painel["porCategoria"][number]>();
  for (const l of analisadas) {
    const c = porCat.get(l.categoria) ?? {
      categoria: l.categoria,
      pecas: 0,
      valorCusto: 0,
      vendidos30: 0,
      noMinimo: 0,
      encalhadas: 0,
    };
    c.pecas += l.emEstoque;
    c.valorCusto += l.analise.valorParadoCusto;
    c.vendidos30 += l.analise.vendidos30;
    if (noMinimo(l.disponivel, l.minimo)) c.noMinimo++;
    if (l.analise.encalhada) c.encalhadas++;
    porCat.set(l.categoria, c);
  }

  return {
    totais: {
      pecas,
      disponiveis: soma((l) => l.disponivel),
      reservadas: soma((l) => l.reservado),
      valorCusto: soma((l) => l.analise.valorParadoCusto),
      valorAtacado: soma((l) => l.emEstoque * l.atacado),
      variacoes: analisadas.length,
      noMinimo: analisadas.filter((l) => noMinimo(l.disponivel, l.minimo)).length,
      zeradas: analisadas.filter((l) => l.disponivel === 0).length,
      encalhadas: encalhadas.length,
      valorEncalhadoCusto: encalhadas.reduce((s, l) => s + l.analise.valorParadoCusto, 0),
      vendidos30,
      giroPct: pecas + vendidos30 > 0 ? (vendidos30 / (pecas + vendidos30)) * 100 : 0,
    },
    // repor: as mais urgentes primeiro — menos cobertura, depois menos disponível
    repor: analisadas
      .filter((l) => l.analise.repor > 0 && !l.dono)
      .sort(
        (a, b) =>
          (a.analise.coberturaDias ?? 9999) - (b.analise.coberturaDias ?? 9999) ||
          a.disponivel - b.disponivel
      )
      .slice(0, TETO_DAS_LISTAS),
    encalhadas: encalhadas
      .sort((a, b) => b.analise.valorParadoCusto - a.analise.valorParadoCusto)
      .slice(0, TETO_DAS_LISTAS),
    maisVendidas: analisadas
      .filter((l) => l.analise.vendidos30 > 0)
      .sort((a, b) => b.analise.vendidos30 - a.analise.vendidos30)
      .slice(0, 10),
    porCategoria: [...porCat.values()].sort((a, b) => b.pecas - a.pecas),
    diasDoGiro: DIAS_DO_GIRO,
    diasParaEncalhar: DIAS_PARA_ENCALHAR,
  };
}
