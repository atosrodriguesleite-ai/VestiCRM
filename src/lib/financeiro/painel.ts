import { db } from "../db";
import { PAID_ORDER_STATUSES, round2 } from "../orders";
import { dataDoDia, diaSP } from "./lancamentos";
import { janelaPadraoDaConciliacao } from "./conciliacao-tela";

/**
 * OS NÚMEROS DO PAINEL DO FINANCEIRO (RN-035) — o que a Visão Geral mostra
 * além do saldo, do atrasado e das contas do mês (que continuam em `visao.ts`).
 *
 * Quatro leituras, todas SOMADAS NO BANCO e todas com a régua das telas que
 * já existem — o painel não pode discordar do extrato nem do fluxo de caixa:
 *
 *  - a CURVA PREVISTA dia a dia (de onde saem as projeções de 30/60/90 dias e
 *    o gráfico): saldo de hoje + o que falta receber − o que falta pagar, por
 *    dia de vencimento, com o ATRASADO caindo em hoje (RN-035: a conta vencida
 *    ontem continua sendo dinheiro a receber).
 *  - o RESUMO DO MÊS (entrou, saiu, resultado, ticket médio), comparado com o
 *    MESMO TRECHO do mês anterior — comparar o dia 5 deste mês com o mês
 *    passado inteiro diria "caiu 80%" toda virada de mês.
 *  - PARA ONDE FOI O DINHEIRO: as saídas do mês por categoria.
 *  - as PENDÊNCIAS que pedem um clique (linhas do banco sem par).
 *
 * Cada leitura é CONSULTA + MONTAGEM PURA, separadas: a consulta é uma ida ao
 * banco (e entra no Promise.all da página), a montagem é função sem banco —
 * é ela que os testes exercitam ("fevereiro para no último", "o atrasado cai
 * em hoje") sem precisar de Postgres.
 */

/** Os horizontes da projeção. O gráfico anda até o maior deles. */
export const HORIZONTES = [30, 60, 90] as const;
export const HORIZONTE_MAXIMO: number = HORIZONTES[HORIZONTES.length - 1];

const DIA_MS = 86_400_000;

/* ---- a curva prevista --------------------------------------------------- */

export type PontoPrevisto = {
  /** "2026-09-05" */
  dia: string;
  /** o que vence NESTE dia e ainda falta receber / pagar */
  entra: number;
  sai: number;
  /** acumulado desde hoje, inclusive */
  entraAcum: number;
  saiAcum: number;
  /** saldo de hoje + entraAcum − saiAcum */
  saldo: number;
};

export type CurvaPrevista = {
  saldoHoje: number;
  /** pontos[0] é hoje; pontos[k] é daqui a k dias */
  pontos: PontoPrevisto[];
};

/** Uma linha da consulta: quanto falta de um lado, num dia. */
export type LinhaDaCurva = { dia: string; tipo: string; falta: number };

/**
 * Quanto FALTA receber e pagar em cada dia, de hoje até `dias` adiante —
 * a CONSULTA, somada no banco.
 *
 * O ATRASADO CAI EM HOJE (`GREATEST(vencimento, hoje)`): é dinheiro que a loja
 * vai correr atrás agora, não no passado — mesma régua do saldo previsto e do
 * fluxo de caixa (RN-035/RN-036). Só abate a baixa com data até HOJE: o
 * cheque registrado para amanhã ainda não está na conta, e tirá-lo daqui e do
 * saldo ao mesmo tempo sumiria com o dinheiro.
 */
export async function linhasDaCurva(
  companyId: string,
  hoje = new Date(),
  dias: number = HORIZONTE_MAXIMO
): Promise<LinhaDaCurva[]> {
  const hojeDia = dataDoDia(diaSP(hoje))!;
  const ate = dataDoDia(diaSP(new Date(hoje.getTime() + dias * DIA_MS)))!;
  const linhas = await db.$queryRaw<{ dia: Date; tipo: string; falta: number }[]>`
    SELECT GREATEST(p."vencimento", ${hojeDia}) AS dia,
           l."tipo" AS tipo,
           SUM(p."valor" - COALESCE(pago."total", 0))::float8 AS falta
      FROM "FinParcela" p
      JOIN "FinLancamento" l ON l."id" = p."lancamentoId"
      LEFT JOIN LATERAL (
            SELECT SUM(b."valor") AS "total"
              FROM "FinBaixa" b
             WHERE b."parcelaId" = p."id"
               AND b."estornadaEm" IS NULL
               AND b."data" <= ${hojeDia}
           ) pago ON TRUE
     WHERE p."companyId" = ${companyId}
       AND l."canceladoEm" IS NULL
       AND p."vencimento" <= ${ate}
     GROUP BY 1, 2
  `;
  return linhas.map((l) => ({ dia: diaSP(l.dia), tipo: l.tipo, falta: l.falta }));
}

/**
 * A MONTAGEM da curva, pura: um ponto por dia, acumulando o que entra e o
 * que sai a partir do saldo de hoje. Dia sem vencimento vale zero; linha fora
 * do horizonte (não deveria vir) é ignorada.
 *
 * O `saldoHoje` vem de fora: a tela já o tem somado por conta, e dois
 * caminhos para o mesmo número é como o card e a curva passariam a discordar.
 */
export function montarCurva(
  linhas: LinhaDaCurva[],
  saldoHoje: number,
  hojeDia: string,
  dias: number = HORIZONTE_MAXIMO
): CurvaPrevista {
  const inicio = dataDoDia(hojeDia)!.getTime();
  const pontos: PontoPrevisto[] = [];
  for (let k = 0; k <= dias; k++) {
    pontos.push({
      dia: diaSP(new Date(inicio + k * DIA_MS)),
      entra: 0,
      sai: 0,
      entraAcum: 0,
      saiAcum: 0,
      saldo: saldoHoje,
    });
  }
  for (const l of linhas) {
    const quando = dataDoDia(l.dia);
    if (!quando) continue;
    // o atrasado já veio como "hoje" do banco; se vier passado, cai em hoje
    const k = Math.max(0, Math.round((quando.getTime() - inicio) / DIA_MS));
    if (k > dias) continue;
    if (l.tipo === "RECEITA") pontos[k].entra = round2(pontos[k].entra + l.falta);
    else pontos[k].sai = round2(pontos[k].sai + l.falta);
  }
  let entraAcum = 0;
  let saiAcum = 0;
  for (const p of pontos) {
    entraAcum = round2(entraAcum + p.entra);
    saiAcum = round2(saiAcum + p.sai);
    p.entraAcum = entraAcum;
    p.saiAcum = saiAcum;
    p.saldo = round2(saldoHoje + entraAcum - saiAcum);
  }
  return { saldoHoje, pontos };
}

/** Consulta + montagem, para quem não precisa paralelizar (o ponta a ponta). */
export async function curvaPrevista(
  companyId: string,
  saldoHoje: number,
  hoje = new Date(),
  dias: number = HORIZONTE_MAXIMO
): Promise<CurvaPrevista> {
  return montarCurva(await linhasDaCurva(companyId, hoje, dias), saldoHoje, diaSP(hoje), dias);
}

export type Projecao = {
  dias: number;
  /** "2026-10-05" */
  ate: string;
  saldo: number;
  aReceber: number;
  aPagar: number;
  /** saldo previsto − saldo de hoje */
  diferenca: number;
  /** (saldo hoje + a receber) / a pagar, em %, teto 200 — 100 quando nada a pagar */
  cobertura: number;
};

/** A projeção de um horizonte, lida da curva. Pura. */
export function projecao(curva: CurvaPrevista, dias: number): Projecao {
  const p = curva.pontos[Math.min(dias, curva.pontos.length - 1)];
  const cobertura =
    p.saiAcum > 0
      ? Math.min(200, Math.round(((curva.saldoHoje + p.entraAcum) / p.saiAcum) * 100))
      : 100;
  return {
    dias,
    ate: p.dia,
    saldo: p.saldo,
    aReceber: p.entraAcum,
    aPagar: p.saiAcum,
    diferenca: round2(p.saldo - curva.saldoHoje),
    cobertura,
  };
}

/** O dia em que o caixa fica mais apertado dentro do horizonte. Pura. */
export function pontoMaisBaixo(pontos: PontoPrevisto[]): PontoPrevisto | null {
  if (pontos.length === 0) return null;
  return pontos.reduce((m, p) => (p.saldo < m.saldo ? p : m), pontos[0]);
}

/* ---- o resumo do mês ---------------------------------------------------- */

export type Indicador = {
  atual: number;
  /** o mesmo trecho do mês anterior (null sem nenhum movimento lá) */
  anterior: number | null;
  /** variação % contra o mesmo trecho do mês anterior; null sem base */
  variacao: number | null;
  /** houve movimento no trecho anterior? (é o que separa "sem base" de "deu zero/prejuízo") */
  temBase: boolean;
  /** um valor por dia do mês, do dia 1 até hoje */
  serie: number[];
  /** o mesmo trecho do mês anterior (pode ser mais curto: fevereiro) */
  serieAnterior: number[];
};

export type ResumoDoMes = {
  entradas: Indicador;
  saidas: Indicador;
  resultado: Indicador;
  ticket: Indicador & { pedidos: number; pedidosAnterior: number };
  /** "setembro" e "agosto", para a tela dizer com quem está comparando */
  mes: string;
  mesAnterior: string;
  /** até que dia do mês anterior a comparação vai */
  diaDaComparacao: number;
};

/**
 * Variação % contra a base. Sem base (zero ou negativa) não há variação —
 * "+∞%" não ajuda ninguém, e o selo simplesmente não aparece.
 */
export function variacao(atual: number, anterior: number | null): number | null {
  if (anterior == null || anterior <= 0) return null;
  return round2(((atual - anterior) / anterior) * 100);
}

const NOME_DO_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** O recorte de tempo do resumo: este mês até hoje, e o mesmo trecho do anterior. */
export type JanelaDoMes = {
  /** "2026-09-05" */
  hojeDia: string;
  diaHoje: number;
  /** "2026-09" e "2026-08" */
  prefixoMes: string;
  prefixoAnt: string;
  /** até que dia do mês anterior vai a comparação (fevereiro para no último) */
  diaDaComparacao: number;
  mes: string;
  mesAnterior: string;
  /** os DIAS (meio-dia UTC) para as baixas: do 1º do mês anterior até hoje */
  inicioAnt: Date;
  ateHoje: Date;
  /** os INSTANTES (relógio de São Paulo) para os pedidos pagos */
  inicioMesSP: Date;
  fimMesSP: Date;
  inicioAntSP: Date;
  fimAntSP: Date;
};

/**
 * A janela, pura. Dois relógios porque são duas perguntas:
 *
 *  - as BAIXAS têm DIA (meio-dia UTC, RN-030): este mês do dia 1 até hoje, e
 *    o mês anterior do dia 1 até o MESMO dia — fevereiro para no dia 28;
 *  - os PEDIDOS têm INSTANTE (`paidAt`): do dia 1 às 00h de São Paulo até
 *    agora, e o MESMO TANTO DE RELÓGIO no mês anterior — mas nunca além do
 *    fim dele: em 30/03 o "mesmo tanto" de fevereiro invadiria 1º e 2 de
 *    março, contando o pedido de hoje dos dois lados e desmentindo o rótulo
 *    "vs. 1 a 28 de fevereiro" (achado da revisão de 05/09/2026).
 */
export function janelaDoMes(hoje: Date): JanelaDoMes {
  const hojeDia = diaSP(hoje);
  const [ano, mes, diaHoje] = hojeDia.split("-").map(Number);
  const prefixoMes = hojeDia.slice(0, 7);
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;
  const ultimoDiaAnt = new Date(Date.UTC(anoAnt, mesAnt, 0)).getUTCDate();
  const diaDaComparacao = Math.min(diaHoje, ultimoDiaAnt);
  const prefixoAnt = `${anoAnt}-${String(mesAnt).padStart(2, "0")}`;
  // São Paulo é UTC−3 o ano inteiro (sem horário de verão desde 2019)
  const inicioMesSP = new Date(`${prefixoMes}-01T03:00:00.000Z`);
  const inicioAntSP = new Date(`${prefixoAnt}-01T03:00:00.000Z`);
  const decorrido = Math.max(0, hoje.getTime() - inicioMesSP.getTime());
  return {
    hojeDia,
    diaHoje,
    prefixoMes,
    prefixoAnt,
    diaDaComparacao,
    mes: NOME_DO_MES[mes - 1],
    mesAnterior: NOME_DO_MES[mesAnt - 1],
    inicioAnt: dataDoDia(`${prefixoAnt}-01`)!,
    ateHoje: dataDoDia(hojeDia)!,
    inicioMesSP,
    fimMesSP: hoje,
    inicioAntSP,
    // o fim do mês anterior é o instante antes do 1º deste mês
    fimAntSP: new Date(Math.min(inicioAntSP.getTime() + decorrido, inicioMesSP.getTime() - 1)),
  };
}

/** Um movimento somado num dia (o que a consulta devolve por dia). */
export type MovimentoDoDia = { dia: string; valor: number };

/**
 * A MONTAGEM de um indicador, pura: distribui os movimentos do dia nas duas
 * séries (este mês e o mesmo trecho do anterior), soma e compara. O que cair
 * fora dos dois trechos (o dia 28 do mês anterior, quando hoje é 15) fica de
 * fora — é exatamente a régua "mesmo trecho".
 */
export function montarIndicador(movimentos: MovimentoDoDia[], j: JanelaDoMes): Indicador {
  const serie = Array.from({ length: j.diaHoje }, () => 0);
  const serieAnterior = Array.from({ length: j.diaDaComparacao }, () => 0);
  for (const m of movimentos) {
    const dia = Number(m.dia.slice(8, 10));
    if (m.dia.startsWith(j.prefixoMes)) {
      if (dia >= 1 && dia <= j.diaHoje) serie[dia - 1] = round2(serie[dia - 1] + m.valor);
    } else if (m.dia.startsWith(j.prefixoAnt)) {
      if (dia >= 1 && dia <= j.diaDaComparacao)
        serieAnterior[dia - 1] = round2(serieAnterior[dia - 1] + m.valor);
    }
  }
  const atual = round2(serie.reduce((s, v) => s + v, 0));
  const temBase = serieAnterior.some((v) => v !== 0);
  const anterior = temBase ? round2(serieAnterior.reduce((s, v) => s + v, 0)) : null;
  return { atual, anterior, variacao: variacao(atual, anterior), temBase, serie, serieAnterior };
}

/** Entradas − saídas, dia a dia. O resultado não tem variação % de propósito. */
export function montarResultado(entradas: Indicador, saidas: Indicador): Indicador {
  const temBase = entradas.temBase || saidas.temBase;
  return {
    atual: round2(entradas.atual - saidas.atual),
    anterior: temBase ? round2((entradas.anterior ?? 0) - (saidas.anterior ?? 0)) : null,
    // resultado pode ser negativo dos dois lados: a variação % de um número
    // negativo confunde mais do que explica — a tela mostra os dois valores
    variacao: null,
    temBase,
    serie: entradas.serie.map((v, i) => round2(v - saidas.serie[i])),
    serieAnterior: entradas.serieAnterior.map((v, i) => round2(v - saidas.serieAnterior[i])),
  };
}

/** Baixa somada como o extrato soma: valor − desconto + juros (RN-030). */
type SomaDeBaixa = { valor: number | null; desconto: number | null; juros: number | null };
const movimentado = (s: SomaDeBaixa) =>
  round2((s.valor ?? 0) - (s.desconto ?? 0) + (s.juros ?? 0));

/**
 * O que entrou e saiu das contas neste mês, dia a dia, ao lado do MESMO
 * TRECHO do mês anterior — e o ticket médio dos pedidos pagos (RN-001), pelo
 * valor VENDIDO (netTotal, RN-002), porque frete não é receita da loja.
 *
 * A régua do "entrou/saiu" é a do extrato (RN-032): baixa viva, com data no
 * período, de lançamento não cancelado, valendo valor − desconto + juros. É o
 * número que bate com o banco.
 */
export async function resumoDoMes(companyId: string, hoje = new Date()): Promise<ResumoDoMes> {
  const j = janelaDoMes(hoje);

  const porDia = (tipo: "RECEITA" | "DESPESA") =>
    db.finBaixa.groupBy({
      by: ["data"],
      where: {
        companyId,
        estornadaEm: null,
        data: { gte: j.inicioAnt, lte: j.ateHoje },
        parcela: { lancamento: { tipo, canceladoEm: null } },
      },
      _sum: { valor: true, desconto: true, juros: true },
    });
  const ticketDe = (gte: Date, lte: Date) =>
    db.order.aggregate({
      where: {
        companyId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte, lte },
      },
      // VALOR VENDIDO (netTotal): o frete atravessa a loja e não é ticket
      _avg: { netTotal: true },
      _count: true,
    });

  const [receitas, despesas, ticketAtual, ticketAnt] = await Promise.all([
    porDia("RECEITA"),
    porDia("DESPESA"),
    ticketDe(j.inicioMesSP, j.fimMesSP),
    ticketDe(j.inicioAntSP, j.fimAntSP),
  ]);

  const movimentos = (linhas: { data: Date; _sum: SomaDeBaixa }[]): MovimentoDoDia[] =>
    linhas.map((l) => ({ dia: diaSP(l.data), valor: movimentado(l._sum) }));
  const entradas = montarIndicador(movimentos(receitas), j);
  const saidas = montarIndicador(movimentos(despesas), j);

  const ticketAtualValor = round2(ticketAtual._avg.netTotal ?? 0);
  const temBaseTicket = ticketAnt._count > 0;
  const ticketAntValor = temBaseTicket ? round2(ticketAnt._avg.netTotal ?? 0) : null;
  return {
    entradas,
    saidas,
    resultado: montarResultado(entradas, saidas),
    ticket: {
      atual: ticketAtualValor,
      anterior: ticketAntValor,
      variacao: variacao(ticketAtualValor, ticketAntValor),
      temBase: temBaseTicket,
      serie: [],
      serieAnterior: [],
      pedidos: ticketAtual._count,
      pedidosAnterior: ticketAnt._count,
    },
    mes: j.mes,
    mesAnterior: j.mesAnterior,
    diaDaComparacao: j.diaDaComparacao,
  };
}

/* ---- para onde foi o dinheiro ------------------------------------------- */

export type Fatia = { nome: string; valor: number };

/** Quantas categorias aparecem com nome; o resto vira "Outras". */
export const FATIAS_COM_NOME = 5;

/**
 * As saídas do período por categoria (a categoria que a lojista escolheu no
 * lançamento, não a raiz da árvore — "Aluguel" diz mais que "Administrativas").
 * Mesma régua de dinheiro do extrato. A transferência entre contas não é
 * saída (RN-032) e não entra: ela não tem baixa.
 */
export async function saidasPorCategoria(
  companyId: string,
  de: Date,
  ate: Date
): Promise<{ fatias: Fatia[]; total: number }> {
  const linhas = await db.$queryRaw<{ categoriaId: string | null; total: number }[]>`
    SELECT l."categoriaId" AS "categoriaId",
           SUM(b."valor" - b."desconto" + b."juros")::float8 AS total
      FROM "FinBaixa" b
      JOIN "FinParcela" p ON p."id" = b."parcelaId"
      JOIN "FinLancamento" l ON l."id" = p."lancamentoId"
     WHERE b."companyId" = ${companyId}
       AND b."estornadaEm" IS NULL
       AND b."data" >= ${de} AND b."data" <= ${ate}
       AND l."tipo" = 'DESPESA'
       AND l."canceladoEm" IS NULL
     GROUP BY 1
  `;
  if (linhas.length === 0) return { fatias: [], total: 0 };
  const ids = linhas.map((l) => l.categoriaId).filter((x): x is string => Boolean(x));
  const categorias = ids.length
    ? await db.finCategoria.findMany({
        where: { companyId, id: { in: ids } },
        select: { id: true, nome: true },
      })
    : [];
  const nomeDe = new Map(categorias.map((c) => [c.id, c.nome]));
  const todas = linhas
    .map((l) => ({
      nome: (l.categoriaId && nomeDe.get(l.categoriaId)) || "Sem categoria",
      valor: round2(l.total),
    }))
    .filter((f) => f.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const total = round2(todas.reduce((s, f) => s + f.valor, 0));
  return { fatias: agruparCauda(todas, FATIAS_COM_NOME), total };
}

/** As N maiores com nome; o resto somado em "Outras". Pura. */
export function agruparCauda(fatias: Fatia[], comNome: number): Fatia[] {
  if (fatias.length <= comNome) return fatias;
  const cabeca = fatias.slice(0, comNome);
  const cauda = round2(fatias.slice(comNome).reduce((s, f) => s + f.valor, 0));
  return cauda > 0 ? [...cabeca, { nome: "Outras", valor: cauda }] : cabeca;
}

/* ---- pendências --------------------------------------------------------- */

export type PendenciaDoBanco = {
  /** a conta que a tela de conciliação abre por padrão (null = nenhuma cadastrada) */
  contaNome: string | null;
  /** linhas do extrato dela, na janela padrão da tela, sem nenhum vínculo */
  semPar: number;
};

/**
 * Linhas do extrato do banco que ainda não casaram com nada (RN-037) — o
 * número do botão "Conferir com o banco". É o MESMO número que a tela de
 * destino mostra ao abrir: a mesma conta (a que ela abre por padrão) e a
 * mesma janela (`janelaPadraoDaConciliacao`) — contar a loja inteira, desde
 * sempre, fazia o painel dizer 12 e a tela mostrar 3 (achado da revisão de
 * 05/09/2026). Pendente é a linha não ignorada e sem nenhum vínculo.
 */
export async function pendenciaDoBanco(
  companyId: string,
  hoje = new Date()
): Promise<PendenciaDoBanco> {
  // a MESMA escolha da tela: contas ativas, padrão primeiro, depois pelo nome
  const conta = await db.finConta.findFirst({
    where: { companyId, arquivadaEm: null },
    orderBy: [{ padrao: "desc" }, { nome: "asc" }],
    select: { id: true, nome: true },
  });
  if (!conta) return { contaNome: null, semPar: 0 };
  const janela = janelaPadraoDaConciliacao(diaSP(hoje));
  const semPar = await db.finOfxLinha.count({
    where: {
      companyId,
      contaId: conta.id,
      data: { gte: dataDoDia(janela.de)!, lte: dataDoDia(janela.ate)! },
      ignoradaEm: null,
      vinculos: { none: {} },
    },
  });
  return { contaNome: conta.nome, semPar };
}
