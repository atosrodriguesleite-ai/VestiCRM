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
/** a última venda é procurada até aqui — além disso é "há mais de 1 ano" */
export const DIAS_DA_ULTIMA_VENDA = 365;

export type VendaDaVariacao = { vendidos30: number; ultimaVendaEm: Date | null };

export type VendasDaLoja = {
  porVariacao: Map<string, VendaDaVariacao>;
  /** peças vendidas no período em item SEM variação no cadastro (produto apagado, item da Nuvemshop que não casou por SKU) — ficam fora do giro e a tela DIZ */
  vendidasSemPeca: number;
};

/** Vendas dos últimos N dias e última venda de cada variação (pedido pago). */
export async function vendasPorVariacao(companyId: string, agora = new Date()): Promise<VendasDaLoja> {
  const desde = new Date(agora.getTime() - DIAS_DO_GIRO * 86_400_000);
  const desdeUmAno = new Date(agora.getTime() - DIAS_DA_ULTIMA_VENDA * 86_400_000);
  // pelo índice Order(companyId, paidAt): todo pedido pago tem `paidAt` (a
  // migração 20260727 preencheu o legado). Um ano de janela — a loja de
  // cinco anos não varre a história inteira a cada abertura do painel
  // (achado da revisão de performance); além disso é "há mais de 1 ano".
  const rows = await db.$queryRaw<
    { variantId: string | null; vendidos30: number; ultimaVendaEm: Date | null }[]
  >(Prisma.sql`
    SELECT i."variantId",
           COALESCE(SUM(CASE WHEN o."paidAt" >= ${desde} THEN i."quantity" ELSE 0 END), 0)::int AS "vendidos30",
           MAX(o."paidAt") AS "ultimaVendaEm"
      FROM "Order" o
      JOIN "OrderItem" i ON i."orderId" = o."id"
     WHERE o."companyId" = ${companyId}
       AND o."paidAt" >= ${desdeUmAno}
       AND o."status" = ANY(${[...PAID_ORDER_STATUSES]}::text[]::"OrderStatus"[])
     GROUP BY i."variantId"
  `);
  const porVariacao = new Map<string, VendaDaVariacao>();
  let vendidasSemPeca = 0;
  for (const r of rows) {
    if (r.variantId) porVariacao.set(r.variantId, { vendidos30: r.vendidos30, ultimaVendaEm: r.ultimaVendaEm });
    else vendidasSemPeca += r.vendidos30;
  }
  return { porVariacao, vendidasSemPeca };
}

export type Situacao = "REPOR" | "ENCALHADA" | "OK" | "SEM_VENDA" | "ZERADA";

export type AnaliseDaPeca = {
  /** peças por dia nos últimos 30 dias */
  giroDia: number;
  vendidos30: number;
  /** dias que o disponível cobre no ritmo atual; null = sem venda no período */
  coberturaDias: number | null;
  /** null = nunca vendeu */
  diasSemVenda: number | null;
  /** dias desde o cadastro do produto (é o que conta para quem nunca vendeu) */
  diasDeCadastro: number;
  encalhada: boolean;
  /** R$ parado a custo (disponível + reservado × custo) */
  valorParadoCusto: number;
  /** quantas peças repor (0 = não precisa) */
  repor: number;
  situacao: Situacao;
};

/**
 * A conta de UMA variação (pura, testável).
 *
 * ENCALHADA exige duas coisas: peça DISPONÍVEL (a reservada em pedido tem
 * dono, não está parada) e 60 dias sem venda — contados da última venda ou,
 * para quem nunca vendeu, do CADASTRO. Sem a segunda régua a coleção que
 * entrou na segunda aparecia "encalhada, R$ 12.000 parados" na terça
 * (achado da revisão de dados).
 */
export function analisarPeca(
  l: Pick<LinhaDoInventario, "disponivel" | "emEstoque" | "minimo" | "custo" | "cadastradoEm">,
  venda: VendaDaVariacao | undefined,
  agora: Date
): AnaliseDaPeca {
  const vendidos30 = venda?.vendidos30 ?? 0;
  const giroDia = vendidos30 / DIAS_DO_GIRO;
  const coberturaDias = giroDia > 0 ? Math.floor(l.disponivel / giroDia) : null;
  const diasSemVenda = venda?.ultimaVendaEm
    ? Math.floor((agora.getTime() - venda.ultimaVendaEm.getTime()) / 86_400_000)
    : null;
  const diasDeCadastro = Math.floor((agora.getTime() - new Date(l.cadastradoEm).getTime()) / 86_400_000);
  const diasParada = diasSemVenda ?? diasDeCadastro;
  const encalhada = l.disponivel > 0 && diasParada >= DIAS_PARA_ENCALHAR;
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
    diasDeCadastro,
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
    /** peças vendidas no período sem peça no cadastro — fora do giro, e a tela diz */
    vendidasSemPeca: number;
    /** % do que estava à venda que saiu nos 30 dias: vendidos ÷ (disponível + vendidos) — o reservado de pedido pago JÁ está em vendidos */
    giroPct: number;
  };
  /** TODA linha no mínimo (a mesma régua do sino e do Dashboard); a sugestão pode ser 0 e a de dono externo se repõe lá */
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
  return resumirPainel(linhas, vendas, agora);
}

/** A montagem do painel, pura (testável sem banco). */
export function resumirPainel(linhas: LinhaDoInventario[], vendas: VendasDaLoja, agora: Date): Painel {
  const analisadas: LinhaAnalisada[] = linhas.map((l) => ({
    ...l,
    analise: analisarPeca(l, vendas.porVariacao.get(l.variantId), agora),
  }));

  const soma = (f: (l: LinhaAnalisada) => number) => analisadas.reduce((s, l) => s + f(l), 0);
  const vendidos30 = soma((l) => l.analise.vendidos30);
  const pecas = soma((l) => l.emEstoque);
  const disponiveis = soma((l) => l.disponivel);
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
      disponiveis,
      reservadas: soma((l) => l.reservado),
      valorCusto: soma((l) => l.analise.valorParadoCusto),
      valorAtacado: soma((l) => l.emEstoque * l.atacado),
      variacoes: analisadas.length,
      noMinimo: analisadas.filter((l) => noMinimo(l.disponivel, l.minimo)).length,
      zeradas: analisadas.filter((l) => l.disponivel === 0).length,
      encalhadas: encalhadas.length,
      valorEncalhadoCusto: encalhadas.reduce((s, l) => s + l.analise.valorParadoCusto, 0),
      vendidos30,
      vendidasSemPeca: vendas.vendidasSemPeca,
      giroPct: disponiveis + vendidos30 > 0 ? (vendidos30 / (disponiveis + vendidos30)) * 100 : 0,
    },
    // repor: TODA peça no mínimo (o sino diz "veja o que repor" — a lista tem
    // que ter o mesmo número), as mais urgentes primeiro
    repor: analisadas
      .filter((l) => noMinimo(l.disponivel, l.minimo))
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
