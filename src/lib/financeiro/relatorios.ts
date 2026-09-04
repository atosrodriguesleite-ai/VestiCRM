import { db } from "../db";
import { round2 } from "../orders";
import { saldoAte } from "./extrato";
import { dataDoDia, diaSP, saldoDaParcela, valorMovimentado } from "./lancamentos";
import {
  acumularSaldo,
  blocoDREdoCodigo,
  mesDoPrevisto,
  mesesEntre,
  raizDoCodigo,
  TETO_MESES,
  type AgrupamentoFluxo,
  type BlocoDRE,
  type BlocoRelatorio,
  type LinhaRelatorio,
  type ModoFluxo,
  type RelatorioDRE,
  type RelatorioFluxo,
} from "./relatorios-tipos";

/**
 * OS DOIS RELATÓRIOS QUE RESPONDEM PERGUNTAS DIFERENTES (RN-036).
 *
 * O DRE responde "a loja deu LUCRO?" e o Fluxo de Caixa responde "tem
 * DINHEIRO?". Parecem a mesma pergunta e não são — é por não separá-las que
 * loja lucrativa quebra:
 *
 *  • o DRE é por COMPETÊNCIA: a venda de agosto é resultado de agosto, mesmo
 *    que a cliente pague em outubro. É a conta do lucro.
 *  • o Fluxo de Caixa é por DATA DO DINHEIRO: a mesma venda aparece em
 *    outubro, quando entrou. É a conta do caixa.
 *
 * Investimento (07) entra no fluxo e NÃO entra no DRE: comprar uma máquina de
 * R$ 8.000 tira o dinheiro do caixa hoje, mas não é prejuízo — é dinheiro que
 * virou máquina. Somá-lo ao resultado faria um mês bom parecer desastre.
 */

/** Teto de linhas lidas do banco por relatório (o período já limita). */
export const TETO_RELATORIO = 20_000;
/** Teto do atrasado trazido de antes do período (mais recente primeiro). */
export const TETO_ATRASADO = 5_000;

/** O mês está entre as colunas do relatório? */
const indiceTem = (meses: string[], mes: string) => meses.includes(mes);

const mesDe = (d: Date) => diaSP(d).slice(0, 7);
const primeiroDiaDoMes = (mes: string) => dataDoDia(`${mes}-01`)!;
const ultimoDiaDoMes = (mes: string) => {
  const [ano, m] = mes.split("-").map(Number);
  const dia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return dataDoDia(`${mes}-${String(dia).padStart(2, "0")}`)!;
};

/** Soma um valor na linha do mês certo, criando a linha se for a primeira. */
function acumular(
  mapa: Map<string, LinhaRelatorio>,
  chave: string,
  rotulo: string,
  indiceDoMes: number,
  qtdMeses: number,
  valor: number
) {
  const linha =
    mapa.get(chave) ??
    ({ chave, rotulo, meses: new Array(qtdMeses).fill(0), total: 0 } as LinhaRelatorio);
  linha.meses[indiceDoMes] = round2(linha.meses[indiceDoMes] + valor);
  linha.total = round2(linha.total + valor);
  mapa.set(chave, linha);
}

const ordenarPorTotal = (linhas: LinhaRelatorio[]) =>
  [...linhas].sort((a, b) => b.total - a.total);

/**
 * Quais RAÍZES da árvore de categorias desta loja são do SISTEMA.
 *
 * O bloco "07 · Investimentos" fica fora do resultado (RN-036) — mas só
 * quando ele é o nosso: a loja pode ter criado uma categoria dela que ficou
 * com o código "07", e a despesa real dela sumia do DRE. Perguntar à FOLHA
 * erra do outro lado: "07.01 Máquinas" criada pela lojista DENTRO do nosso
 * bloco é investimento do mesmo jeito. Quem responde é a raiz.
 */
async function raizesDaArvore(companyId: string): Promise<Set<string>> {
  const raizes = await db.finCategoria.findMany({
    where: { companyId, sistema: true, paiId: null },
    select: { codigo: true },
  });
  return new Set(raizes.map((r) => r.codigo));
}

function raizEhDoSistema(raizes: Set<string>, codigo: string | null | undefined) {
  const raiz = raizDoCodigo(codigo);
  return raiz === null ? true : raizes.has(raiz);
}

/* ---- DRE: a loja deu lucro? -------------------------------------------- */

/**
 * O DRE do período, mês a mês, por COMPETÊNCIA — a data em que o fato
 * aconteceu, não a data do pagamento.
 *
 * O valor é o do LANÇAMENTO (que é a soma das parcelas, RN-030): a venda
 * parcelada em 3× é resultado inteiro do mês da venda. Cancelado fica de
 * fora — nunca aconteceu.
 */
export async function montarDRE(
  companyId: string,
  mesInicial: string,
  mesFinal: string
): Promise<RelatorioDRE> {
  const meses = mesesEntre(mesInicial, mesFinal);
  const de = primeiroDiaDoMes(meses[0]);
  const ate = ultimoDiaDoMes(meses[meses.length - 1]);

  const lancamentos = await db.finLancamento.findMany({
    where: { companyId, canceladoEm: null, competencia: { gte: de, lte: ate } },
    select: {
      valor: true,
      tipo: true,
      competencia: true,
      categoria: { select: { codigo: true, nome: true, sistema: true } },
    },
    orderBy: { competencia: "asc" },
    take: TETO_RELATORIO,
  });
  // resultado errado com cara de certo é o pior defeito de um relatório:
  // se o teto estourou, a tela DIZ antes de a lojista tirar conclusão
  // O CORTE DE MESES TAMBÉM CONTA. `mesesEntre` para em 24 colunas, e sem
  // isso a lojista pedindo 2020–2026 via 24 meses desenhados, os filtros
  // ainda mostrando o período inteiro e NENHUM aviso — concluindo que
  // 2022–2026 não teve movimento. "Resultado errado com cara de certo" é o
  // pior desfecho de um relatório (auditoria de 03/09/2026).
  const cortouMeses = meses.length >= TETO_MESES && meses[meses.length - 1] < mesFinal;
  const truncado = lancamentos.length >= TETO_RELATORIO || cortouMeses;

  const raizesDoSistema = await raizesDaArvore(companyId);
  const indice = new Map(meses.map((m, i) => [m, i]));
  const porBloco = new Map<BlocoDRE, Map<string, LinhaRelatorio>>();
  const investimento = new Array(meses.length).fill(0);

  for (const l of lancamentos) {
    const i = indice.get(mesDe(l.competencia));
    if (i === undefined) continue;
    const tipo = l.tipo === "RECEITA" ? "RECEITA" : "DESPESA";
    const bloco = blocoDREdoCodigo(
      l.categoria?.codigo,
      tipo,
      raizEhDoSistema(raizesDoSistema, l.categoria?.codigo)
    );
    if (bloco === null) {
      // investimento: fora do resultado, mas DITO na tela
      investimento[i] = round2(investimento[i] + l.valor);
      continue;
    }
    const rotulo = l.categoria
      ? `${l.categoria.codigo} · ${l.categoria.nome}`
      : "Sem categoria";
    const mapa = porBloco.get(bloco) ?? new Map<string, LinhaRelatorio>();
    acumular(mapa, rotulo, rotulo, i, meses.length, l.valor);
    porBloco.set(bloco, mapa);
  }

  const ordem: BlocoDRE[] = [
    "RECEITA",
    "CUSTO",
    "DESPESA_VENDAS",
    "DESPESA_ADMIN",
    "DESPESA_FINANCEIRA",
  ];
  const blocos: BlocoRelatorio[] = ordem.map((bloco) => {
    const linhas = ordenarPorTotal([...(porBloco.get(bloco)?.values() ?? [])]);
    const somaDoMes = meses.map((_, i) =>
      round2(linhas.reduce((s, l) => s + l.meses[i], 0))
    );
    return {
      bloco,
      linhas,
      meses: somaDoMes,
      total: round2(somaDoMes.reduce((s, v) => s + v, 0)),
    };
  });

  const doBloco = (b: BlocoDRE) => blocos.find((x) => x.bloco === b)!.meses;
  const receita = doBloco("RECEITA");
  const custo = doBloco("CUSTO");
  const lucroBruto = receita.map((v, i) => round2(v - custo[i]));
  const despesas = receita.map((_, i) =>
    round2(
      doBloco("DESPESA_VENDAS")[i] +
        doBloco("DESPESA_ADMIN")[i] +
        doBloco("DESPESA_FINANCEIRA")[i]
    )
  );
  const resultado = lucroBruto.map((v, i) => round2(v - despesas[i]));
  const somar = (v: number[]) => round2(v.reduce((s, x) => s + x, 0));

  return {
    meses,
    truncado,
    blocos,
    receita,
    custo,
    lucroBruto,
    despesas,
    resultado,
    investimento,
    totais: {
      receita: somar(receita),
      custo: somar(custo),
      lucroBruto: somar(lucroBruto),
      despesas: somar(despesas),
      resultado: somar(resultado),
      investimento: somar(investimento),
    },
  };
}

/* ---- fluxo de caixa: tem dinheiro? ------------------------------------- */

type Pessoa = { nome: string } | null;

type Agrupado = { chave: string; rotulo: string };

/**
 * Por onde a linha do fluxo é agrupada. A CHAVE é o id do cadastro, nunca o
 * nome: usando o nome, as duas "Maria Silva" da loja (a RN-020 diz que isso
 * acontece e que o sistema AVISA em vez de juntar) viravam UMA linha só de
 * R$ 12.000, e a lojista não tinha como saber qual das duas deve o quê — o
 * relatório juntando o que o resto do sistema decidiu nunca juntar sozinho
 * (auditoria completa do módulo, 03/09/2026).
 */
function rotuloDoAgrupamento(
  agrupamento: AgrupamentoFluxo,
  l: {
    categoria: { codigo: string; nome: string } | null;
    clienteId: string | null;
    cliente: string | null;
    fornecedorId: string | null;
    fornecedor: Pessoa;
    colecaoId: string | null;
    colecao: { nome: string } | null;
  }
): Agrupado {
  if (agrupamento === "cliente")
    return l.cliente
      ? { chave: l.clienteId ?? l.cliente, rotulo: l.cliente }
      : { chave: "sem-cliente", rotulo: "Sem cliente" };
  if (agrupamento === "fornecedor")
    return l.fornecedor
      ? { chave: l.fornecedorId ?? l.fornecedor.nome, rotulo: l.fornecedor.nome }
      : { chave: "sem-fornecedor", rotulo: "Sem fornecedor" };
  if (agrupamento === "colecao")
    return l.colecao
      ? { chave: l.colecaoId ?? l.colecao.nome, rotulo: l.colecao.nome }
      : { chave: "sem-colecao", rotulo: "Sem coleção" };
  const rotulo = l.categoria
    ? `${l.categoria.codigo} · ${l.categoria.nome}`
    : "Sem categoria";
  return { chave: rotulo, rotulo };
}

const SELECT_DO_LANCAMENTO = {
  tipo: true,
  categoria: { select: { codigo: true, nome: true } },
  customerId: true,
  customer: { select: { name: true } },
  fornecedorId: true,
  fornecedor: { select: { nome: true } },
  colecaoId: true,
  colecao: { select: { nome: true } },
} as const;

/**
 * O fluxo de caixa mês a mês: o que entrou e saiu de verdade (realizado) e o
 * que ainda está marcado para entrar e sair (previsto).
 *
 * O modo MISTO é o que a lojista realmente quer ver: mês fechado mostra o que
 * aconteceu, mês em curso e futuros mostram o que ainda deve acontecer —
 * misturar previsto no passado inventaria dinheiro que já se sabe que não
 * entrou.
 *
 * O saldo inicial do primeiro mês é o saldo REAL da loja (RN-032: somado,
 * nunca digitado); daí para frente cada mês começa onde o anterior terminou.
 */
export async function montarFluxoDeCaixa(
  companyId: string,
  mesInicial: string,
  mesFinal: string,
  agrupamento: AgrupamentoFluxo = "categoria",
  modo: ModoFluxo = "misto",
  hoje = new Date()
): Promise<RelatorioFluxo> {
  const meses = mesesEntre(mesInicial, mesFinal);
  const cortouMeses = meses.length >= TETO_MESES && meses[meses.length - 1] < mesFinal;
  const de = primeiroDiaDoMes(meses[0]);
  const ate = ultimoDiaDoMes(meses[meses.length - 1]);
  const mesDeHoje = mesDe(hoje);

  // No modo MISTO o realizado vale sempre (o que já aconteceu aconteceu,
  // inclusive no mês em curso) e o previsto entra só do mês corrente para
  // frente — a coluna de cada previsão sai do `mesDoPrevisto`, que é onde
  // essa regra mora (e onde o teste a alcança).
  const precisaRealizado = modo !== "previsto";
  const precisaPrevisto = modo !== "realizado";

  // O atrasado de ANTES do período só é buscado quando o mês corrente está
  // dentro do relatório — é lá que ele cai. Teto próprio e ordenado do mais
  // recente para o mais antigo: é onde mora o que ainda está em aberto.
  const cabeAtrasado = modo === "misto" && indiceTem(meses, mesDeHoje);

  const [saldoInicialDoPeriodo, baixas, parcelas, atrasadas, contas, transferencias] =
    await Promise.all([
      saldoAte(companyId, null, new Date(de.getTime() - 1)),
      precisaRealizado
        ? db.finBaixa.findMany({
            where: { companyId, estornadaEm: null, data: { gte: de, lte: ate } },
            select: {
              valor: true,
              desconto: true,
              juros: true,
              data: true,
              parcela: { select: { lancamento: { select: SELECT_DO_LANCAMENTO } } },
            },
            orderBy: { data: "asc" },
            take: TETO_RELATORIO,
          })
        : Promise.resolve([]),
      precisaPrevisto
        ? db.finParcela.findMany({
            where: {
              companyId,
              vencimento: { gte: de, lte: ate },
              lancamento: { canceladoEm: null },
            },
            select: {
              valor: true,
              vencimento: true,
              baixas: { select: { valor: true, estornadaEm: true } },
              lancamento: { select: SELECT_DO_LANCAMENTO },
            },
            orderBy: { vencimento: "asc" },
            take: TETO_RELATORIO,
          })
        : Promise.resolve([]),
      cabeAtrasado ? atrasadoEmAberto(companyId, de) : Promise.resolve([]),
      // conta cadastrada COM saldo dentro do período: o dinheiro aparece no
      // saldo sem ter sido gerado (mesma régua do DFC, RN-035)
      db.finConta.findMany({
        where: { companyId, saldoInicialEm: { gte: de, lte: ate } },
        select: { saldoInicial: true, saldoInicialEm: true },
      }),
      // transferência que cruza o mês (RN-032): saiu em agosto, caiu em
      // setembro. Sem somar a chegada, todos os meses seguintes ficariam
      // abaixo do saldo real — e o extrato deixaria de bater.
      db.finTransferencia.findMany({
        where: {
          companyId,
          canceladaEm: null,
          OR: [
            { dataSaida: { gte: de, lte: ate } },
            { dataEntrada: { gte: de, lte: ate } },
          ],
        },
        select: { valor: true, dataSaida: true, dataEntrada: true },
      }),
    ]);

  const indice = new Map(meses.map((m, i) => [m, i]));
  const entradas = new Map<string, LinhaRelatorio>();
  const saidas = new Map<string, LinhaRelatorio>();

  const aberturas = new Array(meses.length).fill(0);
  for (const c of contas) {
    const i = indice.get(mesDe(c.saldoInicialEm));
    if (i !== undefined) aberturas[i] = round2(aberturas[i] + c.saldoInicial);
  }
  const transito = new Array(meses.length).fill(0);
  for (const t of transferencias) {
    const iSaiu = indice.get(mesDe(t.dataSaida));
    const iCaiu = indice.get(mesDe(t.dataEntrada));
    if (iSaiu === iCaiu) continue; // no mesmo mês ela se anula
    if (iSaiu !== undefined) transito[iSaiu] = round2(transito[iSaiu] - t.valor);
    if (iCaiu !== undefined) transito[iCaiu] = round2(transito[iCaiu] + t.valor);
  }

  for (const b of baixas) {
    const i = indice.get(mesDe(b.data));
    if (i === undefined) continue;
    const l = b.parcela.lancamento;
    const grupo = rotuloDoAgrupamento(agrupamento, {
      ...l,
      clienteId: l.customerId,
      cliente: l.customer?.name ?? null,
    });
    const alvo = l.tipo === "RECEITA" ? entradas : saidas;
    acumular(alvo, grupo.chave, grupo.rotulo, i, meses.length, valorMovimentado(b));
  }

  for (const p of [...parcelas, ...atrasadas]) {
    const mesAlvo = mesDoPrevisto(mesDe(p.vencimento), mesDeHoje, modo);
    if (mesAlvo === null) continue;
    const i = indice.get(mesAlvo);
    if (i === undefined) continue;
    // só o que FALTA: a parte já paga da parcela já entrou pelo realizado
    // (ou entra quando o mês fechar) — contar as duas seria dobrar a venda
    const falta = saldoDaParcela(p);
    if (falta <= 0) continue;
    const l = p.lancamento;
    const grupo = rotuloDoAgrupamento(agrupamento, {
      ...l,
      clienteId: l.customerId,
      cliente: l.customer?.name ?? null,
    });
    const alvo = l.tipo === "RECEITA" ? entradas : saidas;
    acumular(alvo, grupo.chave, grupo.rotulo, i, meses.length, falta);
  }

  const linhasEntradas = ordenarPorTotal([...entradas.values()]);
  const linhasSaidas = ordenarPorTotal([...saidas.values()]);
  const somaDoMes = (linhas: LinhaRelatorio[]) =>
    meses.map((_, i) => round2(linhas.reduce((s, l) => s + l.meses[i], 0)));
  const totalEntradas = somaDoMes(linhasEntradas);
  const totalSaidas = somaDoMes(linhasSaidas);
  const geracao = totalEntradas.map((v, i) => round2(v - totalSaidas[i]));

  // O recorte "só previsto" não ganha saldo: partir do saldo real e somar só
  // previsão daria um número que não é nem saldo nem projeção.
  const mostraSaldo = modo !== "previsto";
  const { saldoInicial, saldoFinal } = acumularSaldo(
    saldoInicialDoPeriodo,
    geracao,
    aberturas,
    transito
  );

  const cortouPeriodo =
    baixas.length >= TETO_RELATORIO || parcelas.length >= TETO_RELATORIO;
  const cortouAtrasado = atrasadas.length >= TETO_ATRASADO;

  return {
    meses,
    entradas: linhasEntradas,
    saidas: linhasSaidas,
    totalEntradas,
    totalSaidas,
    geracao,
    aberturas,
    transito,
    saldoInicial: mostraSaldo ? saldoInicial : [],
    saldoFinal: mostraSaldo ? saldoFinal : [],
    mostraSaldo,
    mesDeCorte: modo === "misto" ? mesDeHoje : null,
    truncado: cortouPeriodo || cortouAtrasado || cortouMeses,
    motivoDoCorte: cortouPeriodo ? "periodo" : cortouAtrasado ? "atrasado" : null,
  };
}

/**
 * As parcelas atrasadas AINDA EM ABERTO de antes do período.
 *
 * O filtro do "em aberto" é feito no BANCO (`valor > soma das baixas vivas`):
 * trazer 5.000 parcelas vencidas e só então descartar as quitadas gastaria o
 * teto com quem já pagou, e a duplicata realmente aberta ficaria de fora do
 * mês corrente — dívida sumindo do fluxo sem ninguém saber.
 */
async function atrasadoEmAberto(companyId: string, de: Date) {
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT p."id"
      FROM "FinParcela" p
      JOIN "FinLancamento" l ON l."id" = p."lancamentoId"
     WHERE p."companyId" = ${companyId}
       AND p."vencimento" < ${de}
       AND l."canceladoEm" IS NULL
       AND p."valor" > COALESCE((
             SELECT SUM(b."valor") FROM "FinBaixa" b
              WHERE b."parcelaId" = p."id" AND b."estornadaEm" IS NULL
           ), 0)
     ORDER BY p."vencimento" DESC
     LIMIT ${TETO_ATRASADO}
  `;
  if (ids.length === 0) return [];
  return db.finParcela.findMany({
    where: { companyId, id: { in: ids.map((r) => r.id) } },
    select: {
      valor: true,
      vencimento: true,
      baixas: { select: { valor: true, estornadaEm: true } },
      lancamento: { select: SELECT_DO_LANCAMENTO },
    },
  });
}
