import { db } from "../db";
import { round2 } from "../orders";
import { diaSP, saldoDaParcela, statusDaParcela, valorMovimentado } from "./lancamentos";

/**
 * O EXTRATO (RN-032) — o livro-caixa da loja: toda entrada, saída e
 * transferência em ordem, com o SALDO ACUMULADO linha a linha. É a tela onde
 * se responde "o sistema bate com o banco?".
 *
 * Duas regras de ouro moram aqui:
 *
 *  1. SALDO NUNCA É DIGITADO, É SOMADO: saldo inicial da conta + tudo que
 *     entrou − tudo que saiu. Não existe campo "saldo atual" no banco para
 *     alguém corrigir na mão e o extrato passar a mentir.
 *  2. TRANSFERÊNCIA NÃO É RECEITA NEM DESPESA: ela sai de uma conta e entra
 *     na outra, e some no total da loja. Contá-la como receita infla o
 *     faturamento; como despesa, inventa prejuízo.
 */

export type LinhaExtrato = {
  id: string;
  data: string;
  tipo: "ENTRADA" | "SAIDA" | "TRANSFERENCIA" | "SALDO_INICIAL";
  descricao: string;
  pessoa: string | null;
  categoria: string | null;
  conta: string;
  documento: string | null;
  valor: number; // com sinal: entra positivo, sai negativo
  saldo: number; // acumulado até esta linha
  lancamentoId: string | null;
};

export type CardsExtrato = {
  receitasRealizadas: number;
  despesasRealizadas: number;
  receitasEmAberto: number;
  despesasEmAberto: number;
  saldoInicial: number;
  saldoFinal: number;
};

export type FiltroExtrato = {
  companyId: string;
  contaId?: string | null;
  de: Date;
  ate: Date;
};

/** Teto de linhas do extrato: período grande demais avisa em vez de travar. */
export const TETO_EXTRATO = 1000;

/**
 * Saldo de uma conta (ou de todas) ATÉ uma data — inclusive. É a soma que
 * abre o extrato e a que fecha cada linha.
 */
export async function saldoAte(
  companyId: string,
  contaId: string | null | undefined,
  ate: Date
): Promise<number> {
  const daConta = contaId ? { id: contaId } : {};
  const doMovimento = contaId ? { contaId } : {};
  // SOMA NO BANCO, nunca na memória: o extrato de uma loja antiga traria
  // dezenas de milhares de baixas para cá só para fechar uma conta
  const [contas, receitas, despesas, saidas, entradas] = await Promise.all([
    db.finConta.aggregate({
      where: { companyId, ...daConta, saldoInicialEm: { lte: ate } },
      _sum: { saldoInicial: true },
    }),
    db.finBaixa.aggregate({
      where: {
        companyId,
        estornadaEm: null,
        data: { lte: ate },
        ...doMovimento,
        parcela: { lancamento: { tipo: "RECEITA" } },
      },
      _sum: { valor: true, desconto: true, juros: true },
    }),
    db.finBaixa.aggregate({
      where: {
        companyId,
        estornadaEm: null,
        data: { lte: ate },
        ...doMovimento,
        parcela: { lancamento: { tipo: "DESPESA" } },
      },
      _sum: { valor: true, desconto: true, juros: true },
    }),
    db.finTransferencia.aggregate({
      where: {
        companyId,
        canceladaEm: null,
        dataSaida: { lte: ate },
        ...(contaId ? { contaOrigemId: contaId } : {}),
      },
      _sum: { valor: true },
    }),
    db.finTransferencia.aggregate({
      where: {
        companyId,
        canceladaEm: null,
        dataEntrada: { lte: ate },
        ...(contaId ? { contaDestinoId: contaId } : {}),
      },
      _sum: { valor: true },
    }),
  ]);

  // movimentado = abatimento − desconto + juros (a soma distribui igual)
  const mov = (a: { _sum: { valor: number | null; desconto: number | null; juros: number | null } }) =>
    (a._sum.valor ?? 0) - (a._sum.desconto ?? 0) + (a._sum.juros ?? 0);

  // sem conta escolhida, as duas pontas da transferência se anulam — que é
  // exatamente o certo: o dinheiro não saiu da loja
  return round2(
    (contas._sum.saldoInicial ?? 0) +
      mov(receitas) -
      mov(despesas) -
      (saidas._sum.valor ?? 0) +
      (entradas._sum.valor ?? 0)
  );
}

export type SaldoDeConta = {
  id: string;
  nome: string;
  cor: string;
  arquivada: boolean;
  saldo: number;
};

/**
 * O saldo de TODAS as contas da loja de uma vez, pela mesma régua do
 * `saldoAte` (saldo inicial + baixas − transferências). São 5 consultas no
 * total, não 5 por conta: o painel abre em toda visita ao Financeiro.
 *
 * A conta ARQUIVADA entra na lista quando ainda tem dinheiro: arquivar é
 * tirar das escolhas novas, não fazer o saldo sumir — e o painel soma todas,
 * então esconder a arquivada faria as linhas não fecharem com o total.
 */
export async function saldosPorConta(
  companyId: string,
  ate: Date
): Promise<SaldoDeConta[]> {
  const [contas, receitas, despesas, saidas, entradas] = await Promise.all([
    db.finConta.findMany({
      where: { companyId },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      select: {
        id: true,
        nome: true,
        cor: true,
        arquivadaEm: true,
        saldoInicial: true,
        saldoInicialEm: true,
      },
    }),
    db.finBaixa.groupBy({
      by: ["contaId"],
      where: {
        companyId,
        estornadaEm: null,
        data: { lte: ate },
        parcela: { lancamento: { tipo: "RECEITA" } },
      },
      _sum: { valor: true, desconto: true, juros: true },
    }),
    db.finBaixa.groupBy({
      by: ["contaId"],
      where: {
        companyId,
        estornadaEm: null,
        data: { lte: ate },
        parcela: { lancamento: { tipo: "DESPESA" } },
      },
      _sum: { valor: true, desconto: true, juros: true },
    }),
    db.finTransferencia.groupBy({
      by: ["contaOrigemId"],
      where: { companyId, canceladaEm: null, dataSaida: { lte: ate } },
      _sum: { valor: true },
    }),
    db.finTransferencia.groupBy({
      by: ["contaDestinoId"],
      where: { companyId, canceladaEm: null, dataEntrada: { lte: ate } },
      _sum: { valor: true },
    }),
  ]);

  const movPorConta = (
    linhas: {
      contaId: string;
      _sum: { valor: number | null; desconto: number | null; juros: number | null };
    }[]
  ) =>
    new Map(
      linhas.map((l) => [
        l.contaId,
        (l._sum.valor ?? 0) - (l._sum.desconto ?? 0) + (l._sum.juros ?? 0),
      ])
    );
  const entrou = movPorConta(receitas);
  const saiu = movPorConta(despesas);
  const transferiuDe = new Map(saidas.map((t) => [t.contaOrigemId, t._sum.valor ?? 0]));
  const transferiuPara = new Map(
    entradas.map((t) => [t.contaDestinoId, t._sum.valor ?? 0])
  );

  return contas.map((c) => ({
    id: c.id,
    nome: c.nome,
    cor: c.cor,
    arquivada: c.arquivadaEm !== null,
    saldo: round2(
      (c.saldoInicialEm <= ate ? c.saldoInicial : 0) +
        (entrou.get(c.id) ?? 0) -
        (saiu.get(c.id) ?? 0) -
        (transferiuDe.get(c.id) ?? 0) +
        (transferiuPara.get(c.id) ?? 0)
    ),
  }));
}

/** O extrato do período, já com o saldo acumulado e os cards do topo. */
export async function carregarExtrato(filtro: FiltroExtrato): Promise<{
  linhas: LinhaExtrato[];
  cards: CardsExtrato;
  truncado: boolean;
}> {
  const { companyId, contaId, de, ate } = filtro;
  const anterior = new Date(de.getTime() - 1);

  const [saldoInicial, baixas, transferencias, parcelasDoPeriodo, aberturas] =
    await Promise.all([
      saldoAte(companyId, contaId, anterior),
      db.finBaixa.findMany({
        where: {
          companyId,
          estornadaEm: null,
          data: { gte: de, lte: ate },
          ...(contaId ? { contaId } : {}),
        },
        include: {
          conta: { select: { nome: true } },
          parcela: {
            select: {
              numero: true,
              lancamento: {
                select: {
                  id: true,
                  tipo: true,
                  descricao: true,
                  documento: true,
                  customer: { select: { name: true } },
                  fornecedor: { select: { nome: true } },
                  categoria: { select: { nome: true, codigo: true } },
                },
              },
            },
          },
        },
        orderBy: { data: "asc" },
        take: TETO_EXTRATO + 1,
      }),
      db.finTransferencia.findMany({
        where: {
          companyId,
          canceladaEm: null,
          ...(contaId
            ? {
                OR: [
                  { contaOrigemId: contaId, dataSaida: { gte: de, lte: ate } },
                  { contaDestinoId: contaId, dataEntrada: { gte: de, lte: ate } },
                ],
              }
            : {
                OR: [
                  { dataSaida: { gte: de, lte: ate } },
                  { dataEntrada: { gte: de, lte: ate } },
                ],
              }),
        },
        include: {
          contaOrigem: { select: { id: true, nome: true } },
          contaDestino: { select: { id: true, nome: true } },
        },
      }),
      // o que VENCE no período e ainda não foi pago/recebido (os "em aberto").
      // Com uma conta escolhida, só o que estava previsto PARA ELA — senão o
      // extrato de uma conta mostraria o em aberto da loja inteira.
      db.finParcela.findMany({
        where: {
          companyId,
          vencimento: { gte: de, lte: ate },
          lancamento: { canceladoEm: null },
          ...(contaId ? { contaId } : {}),
        },
        select: {
          valor: true,
          vencimento: true,
          baixas: { select: { valor: true, estornadaEm: true } },
          lancamento: { select: { tipo: true } },
        },
      }),
      // contas cujo SALDO INICIAL foi declarado DENTRO do período: ele é um
      // evento do dia em que a loja o declarou. Sem esta linha, o extrato do
      // mês em que a conta nasceu abria em zero e fechava com o saldo inteiro
      // faltando — e o fim de um mês não batia com o começo do outro.
      db.finConta.findMany({
        where: {
          companyId,
          ...(contaId ? { id: contaId } : {}),
          saldoInicialEm: { gte: de, lte: ate },
        },
        select: { id: true, nome: true, saldoInicial: true, saldoInicialEm: true },
      }),
    ]);

  const truncado = baixas.length > TETO_EXTRATO;
  const usadas = truncado ? baixas.slice(0, TETO_EXTRATO) : baixas;

  const linhas: Omit<LinhaExtrato, "saldo">[] = [];

  for (const b of usadas) {
    const l = b.parcela.lancamento;
    const entrada = l.tipo === "RECEITA";
    const mov = valorMovimentado(b);
    linhas.push({
      id: `b-${b.id}`,
      data: diaSP(b.data),
      tipo: entrada ? "ENTRADA" : "SAIDA",
      descricao: l.descricao,
      pessoa: l.customer?.name ?? l.fornecedor?.nome ?? null,
      categoria: l.categoria ? `${l.categoria.codigo} · ${l.categoria.nome}` : null,
      conta: b.conta.nome,
      documento: l.documento,
      valor: entrada ? mov : -mov,
      lancamentoId: l.id,
    });
  }

  for (const t of transferencias) {
    // cada ponta é uma linha, no DIA DAQUELA CONTA: a TED sai hoje e cai
    // amanhã, e cada extrato mostra o dinheiro no seu próprio dia
    const mostrarSaida =
      (!contaId || t.contaOrigemId === contaId) &&
      diaSP(t.dataSaida) >= diaSP(de) &&
      diaSP(t.dataSaida) <= diaSP(ate);
    const mostrarEntrada =
      (!contaId || t.contaDestinoId === contaId) &&
      diaSP(t.dataEntrada) >= diaSP(de) &&
      diaSP(t.dataEntrada) <= diaSP(ate);
    const rotulo = t.descricao || "Transferência entre contas";
    if (mostrarSaida)
      linhas.push({
        id: `ts-${t.id}`,
        data: diaSP(t.dataSaida),
        tipo: "TRANSFERENCIA",
        descricao: `${rotulo} → ${t.contaDestino.nome}`,
        pessoa: null,
        categoria: null,
        conta: t.contaOrigem.nome,
        documento: null,
        valor: -t.valor,
        lancamentoId: null,
      });
    if (mostrarEntrada)
      linhas.push({
        id: `te-${t.id}`,
        data: diaSP(t.dataEntrada),
        tipo: "TRANSFERENCIA",
        descricao: `${rotulo} ← ${t.contaOrigem.nome}`,
        pessoa: null,
        categoria: null,
        conta: t.contaDestino.nome,
        documento: null,
        valor: t.valor,
        lancamentoId: null,
      });
  }

  for (const c of aberturas) {
    if (c.saldoInicial === 0) continue;
    linhas.push({
      id: `si-${c.id}`,
      data: diaSP(c.saldoInicialEm),
      tipo: "SALDO_INICIAL",
      descricao: "Saldo inicial da conta",
      pessoa: null,
      categoria: null,
      conta: c.nome,
      documento: null,
      valor: c.saldoInicial,
      lancamentoId: null,
    });
  }

  linhas.sort((a, b) => (a.data === b.data ? a.id.localeCompare(b.id) : a.data.localeCompare(b.data)));

  let acumulado = saldoInicial;
  const comSaldo: LinhaExtrato[] = linhas.map((l) => {
    acumulado = round2(acumulado + l.valor);
    return { ...l, saldo: acumulado };
  });

  // entrou/saiu conta SÓ receita e despesa realizadas: transferência entre
  // contas próprias e saldo inicial não são nem uma coisa nem outra
  const realizadas = comSaldo.filter(
    (l) => l.tipo === "ENTRADA" || l.tipo === "SAIDA"
  );
  const cards: CardsExtrato = {
    receitasRealizadas: round2(
      realizadas.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0)
    ),
    despesasRealizadas: round2(
      realizadas.filter((l) => l.valor < 0).reduce((s, l) => s - l.valor, 0)
    ),
    receitasEmAberto: 0,
    despesasEmAberto: 0,
    saldoInicial,
    saldoFinal: acumulado,
  };
  const agora = new Date();
  for (const p of parcelasDoPeriodo) {
    const status = statusDaParcela(p, agora);
    if (status === "QUITADA") continue;
    const falta = saldoDaParcela(p);
    if (p.lancamento.tipo === "RECEITA")
      cards.receitasEmAberto = round2(cards.receitasEmAberto + falta);
    else cards.despesasEmAberto = round2(cards.despesasEmAberto + falta);
  }

  return { linhas: comSaldo, cards, truncado };
}
