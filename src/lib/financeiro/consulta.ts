import { Prisma } from "@prisma/client";
import { db } from "../db";
import {
  diaSP,
  diasDeAtraso,
  resumoDoPeriodo,
  saldoDaParcela,
  statusDaParcela,
  totalAbatido,
  valorMovimentado,
  type ResumoPeriodo,
  type StatusParcela,
} from "./lancamentos";

/**
 * A CONSULTA DA TELA de contas a receber/pagar (RN-030).
 *
 * A tela lista PARCELAS, não lançamentos: o que a lojista persegue é
 * "o que vence esta semana", e um lançamento em 3× tem três respostas
 * diferentes para isso.
 *
 * O período pode ser lido por três réguas, e a diferença é a pergunta:
 *   • vencimento  → "o que tenho para receber/pagar" (o padrão)
 *   • emissão     → "o que foi lançado no mês" (competência)
 *   • liquidação  → "o que entrou/saiu de verdade" (bate com o banco)
 */

export type BasePeriodo = "vencimento" | "emissao" | "liquidacao";

export type FiltroMovimentacoes = {
  companyId: string;
  tipo: "RECEITA" | "DESPESA";
  base: BasePeriodo;
  de: Date;
  ate: Date;
  status?: StatusParcela | "TODOS";
  q?: string;
};

/** Teto de linhas EXIBIDAS: o período já limita, isto é o cinto extra. */
export const TETO_LINHAS = 500;
/** Teto do resumo: os cards somam o período inteiro, não só a página. */
export const TETO_RESUMO = 20_000;
/**
 * Quantas parcelas a lista lê quando há FILTRO DE SITUAÇÃO. A situação é
 * calculada (sai do vencimento e das baixas), então não dá para filtrar no
 * SQL: era preciso ler, cortar em 500 e só então filtrar — e numa loja com
 * mais de 500 parcelas no mês a lista de "Quitado" aparecia VAZIA enquanto o
 * card mostrava R$ 90 mil (achado da auditoria completa, 03/09/2026). Lendo
 * mais e filtrando ANTES do corte, a lista volta a bater com o card.
 */
export const TETO_COM_FILTRO = 5_000;

export type LinhaMovimentacao = {
  parcelaId: string;
  lancamentoId: string;
  numero: number;
  totalParcelas: number;
  vencimento: string;
  liquidacao: string | null;
  descricao: string;
  documento: string | null;
  pessoa: string | null;
  categoria: string | null;
  conta: string | null;
  valor: number;
  abatido: number;
  saldo: number;
  status: StatusParcela;
  diasAtraso: number;
  cancelado: boolean;
};

export type ResultadoMovimentacoes = {
  linhas: LinhaMovimentacao[];
  resumo: ResumoPeriodo;
  truncado: boolean;
  /** os CARDS não couberam no teto: o período é grande demais para somar */
  resumoTruncado: boolean;
};

/** O que a lista e o resumo têm em comum: o recorte do período. */
function ondeBuscar(filtro: FiltroMovimentacoes): Prisma.FinParcelaWhereInput {
  const { companyId, tipo, base, de, ate } = filtro;
  const busca = filtro.q?.trim();
  return {
    companyId,
    lancamento: {
      tipo,
      ...(base === "emissao" ? { competencia: { gte: de, lte: ate } } : {}),
      ...(busca
        ? {
            OR: [
              { descricao: { contains: busca, mode: "insensitive" } },
              { documento: { contains: busca, mode: "insensitive" } },
              { customer: { name: { contains: busca, mode: "insensitive" } } },
              { fornecedor: { nome: { contains: busca, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    ...(base === "vencimento" ? { vencimento: { gte: de, lte: ate } } : {}),
    ...(base === "liquidacao"
      ? { baixas: { some: { estornadaEm: null, data: { gte: de, lte: ate } } } }
      : {}),
  };
}

export async function carregarMovimentacoes(
  filtro: FiltroMovimentacoes,
  hoje: Date
): Promise<ResultadoMovimentacoes> {
  const { base, de, ate } = filtro;
  const onde = ondeBuscar(filtro);
  const comFiltro = Boolean(filtro.status && filtro.status !== "TODOS");

  // DUAS consultas de propósito (achado da revisão 31/08/2026): os CARDS
  // somam o período INTEIRO, a lista mostra as primeiras 500. Calcular o
  // resumo em cima da página fazia o "Total do período" mostrar menos
  // dinheiro do que existe — justamente o número em que a lojista confia.
  const [paraResumo, parcelas] = await Promise.all([
    db.finParcela.findMany({
      where: onde,
      select: {
        valor: true,
        vencimento: true,
        baixas: { select: { valor: true, desconto: true, juros: true, estornadaEm: true, data: true } },
        lancamento: { select: { canceladoEm: true } },
      },
      // ordem definida: sem ela o Postgres devolve um subconjunto ARBITRÁRIO
      // quando o teto é atingido, e os cards mudam de valor entre dois F5
      orderBy: [{ vencimento: "asc" }, { numero: "asc" }],
      take: TETO_RESUMO + 1,
    }),
    db.finParcela.findMany({
      where: onde,
      include: {
        conta: { select: { nome: true } },
        baixas: {
          orderBy: { data: "asc" },
          include: { conta: { select: { nome: true } } },
        },
        lancamento: {
          select: {
            id: true,
            descricao: true,
            documento: true,
            canceladoEm: true,
            customer: { select: { name: true } },
            fornecedor: { select: { nome: true } },
            categoria: { select: { nome: true, codigo: true } },
            _count: { select: { parcelas: true } },
          },
        },
      },
      orderBy: [{ vencimento: "asc" }, { numero: "asc" }],
      // com filtro de situação a lista lê mais e corta DEPOIS de filtrar
      take: (comFiltro ? TETO_COM_FILTRO : TETO_LINHAS) + 1,
    }),
  ]);

  const teto = comFiltro ? TETO_COM_FILTRO : TETO_LINHAS;
  const leuTudo = parcelas.length <= teto;
  const usadas = leuTudo ? parcelas : parcelas.slice(0, teto);

  const todas: LinhaMovimentacao[] = usadas.map((p) => {
    const cancelado = Boolean(p.lancamento.canceladoEm);
    const ativas = p.baixas.filter((b) => !b.estornadaEm);
    const ultima = ativas[ativas.length - 1];
    return {
      parcelaId: p.id,
      lancamentoId: p.lancamentoId,
      numero: p.numero,
      totalParcelas: p.lancamento._count.parcelas,
      vencimento: diaSP(p.vencimento),
      liquidacao: ultima ? diaSP(ultima.data) : null,
      descricao: p.lancamento.descricao,
      documento: p.lancamento.documento,
      pessoa:
        p.lancamento.customer?.name ?? p.lancamento.fornecedor?.nome ?? null,
      categoria: p.lancamento.categoria
        ? `${p.lancamento.categoria.codigo} · ${p.lancamento.categoria.nome}`
        : null,
      conta: ultima?.conta.nome ?? p.conta?.nome ?? null,
      valor: p.valor,
      abatido: totalAbatido(p.baixas),
      saldo: saldoDaParcela(p),
      status: statusDaParcela(p, hoje, cancelado),
      diasAtraso: diasDeAtraso(p, hoje),
      cancelado,
    };
  });

  // O RESUMO usa TODAS as parcelas do período (nunca só a página) e o filtro
  // de status vale só para a lista: cards que mudam junto com o filtro fazem
  // a lojista achar que o atrasado sumiu quando ela olha só os quitados.
  // No recorte por LIQUIDAÇÃO, o card de recebido/pago soma o que MOVIMENTOU
  // na conta dentro da janela — é esse número que bate com o extrato.
  const resumo = resumoDoPeriodo(
    paraResumo.map((p) => ({
      valor: p.valor,
      vencimento: p.vencimento,
      baixas: p.baixas,
      cancelado: Boolean(p.lancamento.canceladoEm),
    })),
    hoje,
    base === "liquidacao" ? { de, ate } : undefined
  );

  // o filtro de situação vem ANTES do corte da página
  const filtradas = comFiltro
    ? todas.filter((l) => l.status === filtro.status)
    : todas;
  const linhas = filtradas.slice(0, TETO_LINHAS);
  const truncado = !leuTudo || filtradas.length > TETO_LINHAS;

  return { linhas, resumo, truncado, resumoTruncado: paraResumo.length > TETO_RESUMO };
}

/** A ficha completa do lançamento (a janela de detalhe). */
export async function carregarFicha(companyId: string, id: string) {
  const l = await db.finLancamento.findFirst({
    where: { id, companyId },
    include: {
      customer: { select: { id: true, name: true } },
      fornecedor: { select: { id: true, nome: true } },
      categoria: { select: { id: true, nome: true, codigo: true } },
      centroCusto: { select: { id: true, nome: true } },
      colecao: { select: { id: true, nome: true } },
      parcelas: {
        orderBy: { numero: "asc" },
        include: {
          conta: { select: { id: true, nome: true } },
          baixas: {
            orderBy: { createdAt: "asc" },
            include: { conta: { select: { nome: true } } },
          },
        },
      },
      anexos: {
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, autorNome: true, createdAt: true },
      },
      eventos: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!l) return null;
  return {
    ...l,
    parcelas: l.parcelas.map((p) => ({
      ...p,
      saldo: saldoDaParcela(p),
      abatido: totalAbatido(p.baixas),
      baixas: p.baixas.map((b) => ({ ...b, movimentado: valorMovimentado(b) })),
    })),
  };
}
