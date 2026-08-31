import { Prisma } from "@prisma/client";
import { db } from "../db";
import { round2 } from "../orders";
import {
  conferirBaixa,
  dataDoDia,
  diaSP,
  saldoDaParcela,
  statusDaParcela,
  type StatusParcela,
} from "./lancamentos";

/**
 * CARTÃO DE CRÉDITO (RN-037).
 *
 * A conta do cartão NÃO guarda dinheiro — ela junta compras numa FATURA. É
 * essa a diferença que faz a conta bater: a compra de hoje no cartão é
 * despesa de hoje (entra no DRE do mês certo), mas o dinheiro só sai da conta
 * do banco no vencimento da fatura. Lançar a compra como saída do banco no
 * dia da compra é o erro clássico — o extrato passa a divergir do banco e o
 * fluxo mostra dinheiro saindo num mês em que ele ficou.
 *
 * Por isso: a compra vira uma parcela com a conta PREVISTA do cartão e o
 * vencimento da fatura; pagar a fatura dá baixa nessas parcelas na conta do
 * BANCO, que é de onde o dinheiro sai de verdade.
 */

// a regra de em qual fatura cada compra cai é PURA e mora em
// `cartao-fatura.ts` — o formulário de lançamento (navegador) precisa dela
export {
  faturaDaCompra,
  ultimoDiaDoMes,
  type RegraDoCartao,
} from "./cartao-fatura";
import { ultimoDiaDoMes } from "./cartao-fatura";

/* ---- a fatura na tela --------------------------------------------------- */

export type CompraDaFatura = {
  parcelaId: string;
  lancamentoId: string;
  descricao: string;
  fornecedor: string | null;
  categoria: string | null;
  numero: number;
  totalParcelas: number;
  valor: number;
  saldo: number;
  status: StatusParcela;
};

export type Fatura = {
  /** "2026-10" — o mês em que ela vence */
  mes: string;
  vencimento: string;
  compras: CompraDaFatura[];
  total: number;
  emAberto: number;
  paga: boolean;
};

export type CartaoComFaturas = {
  id: string;
  nome: string;
  cor: string;
  diaFechamento: number | null;
  diaVencimento: number | null;
  contaPagamento: { id: string; nome: string } | null;
  faturas: Fatura[];
};

/**
 * As faturas de um cartão: as compras agrupadas pelo vencimento delas. O
 * agrupamento é pela DATA DE VENCIMENTO da parcela porque é ela que o cartão
 * decide na hora da compra (`faturaDaCompra`) — assim uma compra parcelada em
 * 6× entra em seis faturas, que é exatamente o que acontece na vida.
 */
export const TETO_COMPRAS = 1_000;
/** Quantos meses para trás a tela mostra (o resto é histórico do lançamento). */
export const MESES_DE_HISTORICO = 12;

export async function carregarFaturas(
  companyId: string,
  cartaoId: string,
  hoje = new Date()
): Promise<CartaoComFaturas | null> {
  const cartao = await db.finConta.findFirst({
    where: { id: cartaoId, companyId, tipo: "CARTAO" },
    select: {
      id: true,
      nome: true,
      cor: true,
      diaFechamento: true,
      diaVencimento: true,
      contaPagamentoId: true,
    },
  });
  if (!cartao) return null;

  const contaPagamento = cartao.contaPagamentoId
    ? await db.finConta.findFirst({
        where: { id: cartao.contaPagamentoId, companyId },
        select: { id: true, nome: true },
      })
    : null;

  // recorte de tempo ANTES do teto: sem ele, um cartão antigo com mais de
  // mil compras perdia justamente a fatura do mês corrente (a lista vinha
  // ordenada da mais velha para a mais nova) — e sem botão de pagar
  const desde = new Date(hoje);
  desde.setUTCMonth(desde.getUTCMonth() - MESES_DE_HISTORICO);
  const parcelas = await db.finParcela.findMany({
    where: {
      companyId,
      contaId: cartaoId,
      vencimento: { gte: dataDoDia(diaSP(desde))! },
      lancamento: { canceladoEm: null, tipo: "DESPESA" },
    },
    include: {
      baixas: true,
      lancamento: {
        select: {
          id: true,
          descricao: true,
          fornecedor: { select: { nome: true } },
          categoria: { select: { codigo: true, nome: true } },
          parcelas: { select: { id: true } },
        },
      },
    },
    // da mais NOVA para a mais velha: se o teto estourar, quem fica de fora
    // é o passado distante, nunca a fatura que está para vencer
    orderBy: { vencimento: "desc" },
    take: TETO_COMPRAS,
  });

  const porFatura = new Map<string, Fatura>();
  for (const p of parcelas) {
    const dia = diaSP(p.vencimento);
    const mes = dia.slice(0, 7);
    const fatura =
      porFatura.get(mes) ??
      ({ mes, vencimento: dia, compras: [], total: 0, emAberto: 0, paga: false } as Fatura);
    const saldo = saldoDaParcela(p);
    fatura.compras.push({
      parcelaId: p.id,
      lancamentoId: p.lancamento.id,
      descricao: p.lancamento.descricao,
      fornecedor: p.lancamento.fornecedor?.nome ?? null,
      categoria: p.lancamento.categoria
        ? `${p.lancamento.categoria.codigo} · ${p.lancamento.categoria.nome}`
        : null,
      numero: p.numero,
      totalParcelas: p.lancamento.parcelas.length,
      valor: p.valor,
      saldo,
      status: statusDaParcela(p, hoje),
    });
    fatura.total = round2(fatura.total + p.valor);
    fatura.emAberto = round2(fatura.emAberto + saldo);
    porFatura.set(mes, fatura);
  }

  const faturas = [...porFatura.values()]
    .map((f) => ({
      ...f,
      paga: f.emAberto <= 0,
      compras: [...f.compras].reverse(), // a busca vem da mais nova
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  return { ...cartao, contaPagamento, faturas };
}

/* ---- pagar a fatura ----------------------------------------------------- */

export type ResultadoPagamento =
  | { ok: true; parcelas: number; valor: number }
  | { ok: false; erro: string; status: number };

/**
 * Paga a fatura inteira: dá baixa em TODAS as compras dela, de uma vez, na
 * conta de onde o dinheiro sai. Uma fatura de 40 compras baixada uma a uma na
 * mão é onde a lojista desiste do financeiro.
 *
 * Roda em transação SERIALIZÁVEL (mesma régua da baixa avulsa, RN-028): duas
 * pessoas pagando a mesma fatura ao mesmo tempo passariam as duas pela
 * conferência e o mês fecharia pago em dobro.
 */
export async function pagarFatura(
  companyId: string,
  entrada: { cartaoId: string; mes: string; contaId: string; data: Date },
  autorNome: string
): Promise<ResultadoPagamento> {
  const [cartao, conta] = await Promise.all([
    db.finConta.findFirst({
      where: { id: entrada.cartaoId, companyId, tipo: "CARTAO" },
      select: { id: true, nome: true },
    }),
    db.finConta.findFirst({
      where: { id: entrada.contaId, companyId, arquivadaEm: null },
      select: { id: true, nome: true, tipo: true },
    }),
  ]);
  if (!cartao) return { ok: false, erro: "Cartão não encontrado", status: 404 };
  if (!conta)
    return { ok: false, erro: "Escolha a conta de onde o dinheiro sai", status: 400 };
  if (conta.tipo === "CARTAO")
    return {
      ok: false,
      erro: "A fatura de um cartão não se paga com outro cartão",
      status: 400,
    };

  const de = dataDoDia(`${entrada.mes}-01`);
  if (!de) return { ok: false, erro: "Mês inválido", status: 400 };
  const [ano, mes] = entrada.mes.split("-").map(Number);
  const ate = dataDoDia(
    `${entrada.mes}-${String(ultimoDiaDoMes(ano, mes)).padStart(2, "0")}`
  )!;

  try {
    return await db.$transaction(
      async (tx) => {
        const parcelas = await tx.finParcela.findMany({
          where: {
            companyId,
            contaId: cartao.id,
            vencimento: { gte: de, lte: ate },
            lancamento: { canceladoEm: null, tipo: "DESPESA" },
          },
          include: { baixas: true, lancamento: { select: { id: true } } },
        });
        if (parcelas.length === 0)
          return { ok: false as const, erro: "Esta fatura não tem compras", status: 400 };

        let pagas = 0;
        let valor = 0;
        for (const p of parcelas) {
          const saldo = saldoDaParcela(p);
          if (saldo <= 0) continue; // já paga: não paga de novo
          const problema = conferirBaixa(p, { valor: saldo });
          if (problema) continue;
          await tx.finBaixa.create({
            data: {
              companyId,
              parcelaId: p.id,
              contaId: conta.id,
              data: entrada.data,
              valor: saldo,
              desconto: 0,
              juros: 0,
              observacao: `Fatura do ${cartao.nome} de ${entrada.mes}`,
              autorNome,
            },
          });
          await tx.finLancamentoEvento.create({
            data: {
              lancamentoId: p.lancamento.id,
              descricao: `Pago na fatura do ${cartao.nome} (${entrada.mes}) por ${autorNome}`,
              autorNome,
            },
          });
          pagas += 1;
          valor = round2(valor + saldo);
        }
        if (pagas === 0)
          return {
            ok: false as const,
            erro: "Esta fatura já está paga",
            status: 409,
          };
        return { ok: true as const, parcelas: pagas, valor };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (e) {
    // conflito de escrita: a outra pessoa pagou primeiro
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034")
      return {
        ok: false,
        erro: "Alguém pagou esta fatura agora mesmo — atualize a tela",
        status: 409,
      };
    throw e;
  }
}
