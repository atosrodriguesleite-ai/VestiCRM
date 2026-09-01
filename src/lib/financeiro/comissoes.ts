import { Prisma } from "@prisma/client";
import { db } from "../db";
import { PAID_ORDER_STATUSES, round2 } from "../orders";
import { dataDoDia, diaSP } from "./lancamentos";

/**
 * COMISSÃO VIRA CONTA A PAGAR (RN-038).
 *
 * A tela de Comissões sempre soube QUANTO cada vendedora tem a receber; o
 * que faltava era o dinheiro entrar no financeiro. Sem isso a lojista via
 * "sobra R$ 4.000 no mês" sem lembrar das comissões que ainda vai pagar — e
 * comissão é a segunda maior despesa de uma loja de atacado.
 *
 * A conta a pagar nasce da MESMA fonte da tela (pedidos pagos no período,
 * `commissionBase` da loja, percentual da vendedora): dois números diferentes
 * para a mesma comissão é o começo de uma discussão com a equipe.
 *
 * NÃO DUPLICA e NÃO PAGA DUAS VEZES: cada geração carrega
 * `origem = COMISSAO` e `origemId = vendedora:início:fim`, e o par
 * (loja, origem, origemId) é ÚNICO no banco. Antes de criar, o motor ainda
 * recusa período que ENCOSTA num já gerado — mudar um dia no filtro e gerar
 * de novo pagaria o mesmo mês duas vezes.
 */

export const ORIGEM_COMISSAO = "COMISSAO";
/** Categoria da árvore padrão onde a comissão entra (RN-029). */
export const CODIGO_CATEGORIA_COMISSAO = "04.01";

export type ComissaoDoPeriodo = {
  sellerId: string;
  nome: string;
  pedidos: number;
  base: number;
  percentual: number;
  comissao: number;
  /** já existe conta a pagar para esta vendedora neste período? */
  lancamentoId: string | null;
};

/** A chave que impede gerar a mesma comissão duas vezes. */
export function chaveDaComissao(sellerId: string, de: string, ate: string): string {
  return `${sellerId}:${de}:${ate}`;
}

/**
 * A janela de tempo de um período em DIAS de São Paulo.
 *
 * O fim é o último instante do dia ESCOLHIDO — 30/09 termina às 02:59:59.999
 * de 01/10 em UTC. Parar às 02:59 do próprio 30/09 (o engano fácil) deixaria
 * o dia INTEIRO de fora e a vendedora perderia a comissão das vendas do
 * último dia do mês, que é justamente quando a loja mais vende.
 */
export function janelaDoPeriodo(de: string, ate: string): { de: Date; ate: Date } {
  const fim = new Date(`${ate}T03:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return {
    de: new Date(`${de}T03:00:00.000Z`),
    ate: new Date(fim.getTime() - 1),
  };
}

/**
 * Lê a chave de volta: "vendedora:2026-09-01:2026-09-30" (o sufixo `#2` de
 * uma regeração depois de cancelar não muda o período que ela cobre).
 */
export function lerChaveDaComissao(
  origemId: string
): { sellerId: string; de: string; ate: string } | null {
  const partes = origemId.split("#")[0].split(":");
  if (partes.length !== 3) return null;
  const [sellerId, de, ate] = partes;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return null;
  return { sellerId, de, ate };
}

/** Dois períodos se encostam? (regra pura, testável sem banco) */
export function periodosSeCruzam(
  a: { de: string; ate: string },
  b: { de: string; ate: string }
): boolean {
  return a.de <= b.ate && b.de <= a.ate;
}

export type ResultadoComissao =
  | { ok: true; lancamentoId: string; valor: number }
  | { ok: false; erro: string; status: number };

/**
 * Gera (ou devolve) a conta a pagar da comissão de uma vendedora no período.
 * O vencimento é escolhido pela lojista — cada loja paga num dia.
 */
export async function gerarContaDaComissao(
  companyId: string,
  entrada: { sellerId: string; de: string; ate: string; vencimento: Date },
  autorNome: string,
  hoje = new Date()
): Promise<ResultadoComissao> {
  const { sellerId, de, ate, vencimento } = entrada;
  if (de > ate)
    return { ok: false, erro: "O período começa depois de terminar", status: 400 };
  // período que ainda não fechou não vira conta a pagar: a venda que a loja
  // fizer HOJE à tarde ficaria dentro do período registrado e fora do valor —
  // e a trava de sobreposição impediria cobrá-la depois
  if (ate >= diaSP(hoje))
    return {
      ok: false,
      erro: "Este período ainda não fechou — escolha um período que já terminou (ex.: o mês passado)",
      status: 400,
    };
  const janela = janelaDoPeriodo(de, ate);

  const vendedora = await db.user.findFirst({
    where: { id: sellerId, companyId },
    select: { id: true, name: true, commissionRate: true },
  });
  if (!vendedora)
    return { ok: false, erro: "Vendedora não encontrada nesta loja", status: 404 };

  // período que encosta em outro já gerado: recusa DIZENDO qual, senão a
  // mesma venda entraria em duas contas a pagar
  const jaGerados = await db.finLancamento.findMany({
    where: { companyId, origem: ORIGEM_COMISSAO, canceladoEm: null },
    select: { id: true, origemId: true, descricao: true },
  });
  const novo = { de, ate };
  for (const g of jaGerados) {
    const chave = g.origemId ? lerChaveDaComissao(g.origemId) : null;
    if (!chave || chave.sellerId !== sellerId) continue;
    if (chave.de === novo.de && chave.ate === novo.ate)
      return { ok: true, lancamentoId: g.id, valor: 0 }; // idempotente: já existe
    if (periodosSeCruzam(chave, novo))
      return {
        ok: false,
        erro: `Já existe comissão desta vendedora de ${chave.de.split("-").reverse().join("/")} a ${chave.ate
          .split("-")
          .reverse()
          .join("/")} — cancele aquela antes de gerar um período que a cobre`,
        status: 409,
      };
  }

  const { comissao, pedidos, base } = await calcularComissao(companyId, {
    sellerId,
    percentual: vendedora.commissionRate,
    de: janela.de,
    ate: janela.ate,
  });
  if (comissao <= 0)
    return {
      ok: false,
      erro: "Não há comissão a pagar desta vendedora neste período",
      status: 400,
    };

  const categoria = await db.finCategoria.findFirst({
    where: { companyId, codigo: CODIGO_CATEGORIA_COMISSAO },
    select: { id: true },
  });

  const emBR = (dia: string) => dia.split("-").reverse().join("/");
  const descricao = `Comissão · ${vendedora.name} · ${emBR(de)} a ${emBR(ate)}`;

  // Comissão CANCELADA e gerada de novo: o único (loja, origem, origemId)
  // vale para cancelado também, então a segunda geração precisa de uma chave
  // própria — senão a lojista cancela (como a mensagem acima manda) e nunca
  // mais consegue lançar aquele período.
  const chaveBase = chaveDaComissao(sellerId, de, ate);
  const mesmasChaves = await db.finLancamento.count({
    where: {
      companyId,
      origem: ORIGEM_COMISSAO,
      OR: [
        { origemId: chaveBase },
        { origemId: { startsWith: `${chaveBase}#` } },
      ],
    },
  });
  const origemId =
    mesmasChaves === 0 ? chaveBase : `${chaveBase}#${mesmasChaves + 1}`;

  try {
    const lancamento = await db.finLancamento.create({
      data: {
        companyId,
        tipo: "DESPESA",
        descricao,
        valor: comissao,
        categoriaId: categoria?.id ?? null,
        // a competência é o FIM do período: a comissão é daquele mês de vendas
        competencia: dataDoDia(ate)!,
        origem: ORIGEM_COMISSAO,
        origemId,
        observacoes: `${pedidos} pedido(s) pagos, base de R$ ${base.toFixed(2)} × ${vendedora.commissionRate}%`,
        parcelas: {
          create: [
            { companyId, numero: 1, valor: comissao, vencimento },
          ],
        },
        eventos: {
          create: {
            descricao: `Comissão gerada a partir de ${pedidos} pedido(s) pagos por ${autorNome}`,
            autorNome,
          },
        },
      },
      select: { id: true },
    });
    return { ok: true, lancamentoId: lancamento.id, valor: comissao };
  } catch (e) {
    // duas abas gerando junto: o único (loja, origem, origemId) segura
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existente = await db.finLancamento.findFirst({
        where: {
          companyId,
          origem: ORIGEM_COMISSAO,
          origemId,
        },
        select: { id: true },
      });
      if (existente) return { ok: true, lancamentoId: existente.id, valor: comissao };
    }
    throw e;
  }
}

/**
 * A conta da comissão — a MESMA da tela de Comissões: pedidos PAGOS (RN-001)
 * no período, base conforme a loja (subtotal ou o vendido) e o percentual da
 * vendedora.
 */
async function calcularComissao(
  companyId: string,
  p: { sellerId: string; percentual: number; de: Date; ate: Date }
): Promise<{ comissao: number; pedidos: number; base: number }> {
  const [company, pedidos] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: { commissionBase: true },
    }),
    db.order.findMany({
      where: {
        companyId,
        sellerId: p.sellerId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: p.de, lte: p.ate },
      },
      // frete-ok: comissão nunca soma frete — a base é subtotal ou netTotal,
      // exatamente como na tela de Comissões (nenhum `total` entra aqui)
      select: { subtotal: true, netTotal: true },
    }),
  ]);
  const usaVendido = (company?.commissionBase ?? "SUBTOTAL") === "VENDIDO";
  const base = round2(
    pedidos.reduce((s, o) => s + (usaVendido ? o.netTotal : o.subtotal), 0)
  );
  return {
    comissao: round2((base * p.percentual) / 100),
    pedidos: pedidos.length,
    base,
  };
}

export type ComissaoGerada = {
  lancamentoId: string;
  /** é exatamente ESTE período (não só um que cruza) */
  exata: boolean;
  de: string;
  ate: string;
};

/**
 * O que já foi gerado, para a tela mostrar "✓ lançada" — e só quando o
 * período é o MESMO. Uma quinzena gerada não pode marcar o mês inteiro como
 * lançado: a lojista veria "✓" ao lado de um valor muito maior e a segunda
 * metade do mês nunca seria paga.
 */
export async function comissoesJaGeradas(
  companyId: string,
  de: string,
  ate: string
): Promise<Map<string, ComissaoGerada>> {
  const lancamentos = await db.finLancamento.findMany({
    where: { companyId, origem: ORIGEM_COMISSAO, canceladoEm: null },
    select: { id: true, origemId: true },
  });
  const chaveNova = { de, ate };
  const porVendedora = new Map<string, ComissaoGerada>();
  for (const l of lancamentos) {
    const chave = l.origemId ? lerChaveDaComissao(l.origemId) : null;
    if (!chave || !periodosSeCruzam(chave, chaveNova)) continue;
    const exata = chave.de === de && chave.ate === ate;
    const atual = porVendedora.get(chave.sellerId);
    // a exata sempre ganha da que só cruza
    if (!atual || (exata && !atual.exata))
      porVendedora.set(chave.sellerId, {
        lancamentoId: l.id,
        exata,
        de: chave.de,
        ate: chave.ate,
      });
  }
  return porVendedora;
}
