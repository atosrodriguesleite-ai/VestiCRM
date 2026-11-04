import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canSeeAll } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { fimDoDiaSP, inicioDoDiaSP } from "@/lib/periodo";
import {
  janelaDoGrafico,
  montarFaturamento,
  periodoDeComparacao,
  type DadosDoFaturamento,
  type ParametrosDoFaturamento,
  type Periodo,
  type VendaPaga,
} from "./faturamento-regra";

/**
 * O MOTOR do gráfico de faturamento (RN-108): o lado com banco. A régua da
 * consulta é UMA para a página do Dashboard e para a porta que a tela chama
 * ao trocar a comparação — se fossem duas, o número do gráfico mudaria ao
 * clicar na mesma comparação que a página já tinha desenhado.
 */

/** quem vê o quê no faturamento: gerência a loja inteira, vendedora só as vendas dela (RN-007) */
export function escopoDeVenda(user: SessionUser) {
  return canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
}

/**
 * Os pedidos PAGOS (RN-001) com pagamento dentro do período, em dias INTEIROS
 * de São Paulo. Traz só o que o dinheiro precisa: o valor VENDIDO (`netTotal`,
 * RN-002 — o frete atravessa a loja), a data do pagamento e a vendedora.
 */
export async function vendasPagasEntre(
  user: SessionUser,
  periodo: Periodo
): Promise<(VendaPaga & { sellerId: string | null })[]> {
  const gte = inicioDoDiaSP(periodo.de);
  const lte = fimDoDiaSP(periodo.ate);
  if (!gte || !lte) return [];
  return db.order.findMany({
    where: { ...escopoDeVenda(user), status: { in: PAID_ORDER_STATUSES }, paidAt: { gte, lte } },
    select: { netTotal: true, sellerId: true, paidAt: true },
  });
}

/** O pacote do gráfico para um período e uma comparação: duas consultas, em paralelo. */
export async function dadosDoFaturamento(
  user: SessionUser,
  p: ParametrosDoFaturamento
): Promise<DadosDoFaturamento> {
  const comparacao = periodoDeComparacao(p.tipo, p.periodo, p.cmpDe);
  // só o que o gráfico mostra vai ao banco (o teto de dias, nos dois lados)
  const janela = janelaDoGrafico(p.periodo).periodo;
  const janelaComparada = comparacao ? janelaDoGrafico(comparacao).periodo : null;
  const [vendas, vendasComparadas] = await Promise.all([
    vendasPagasEntre(user, janela),
    janelaComparada ? vendasPagasEntre(user, janelaComparada) : Promise.resolve([]),
  ]);
  return montarFaturamento({ periodo: p.periodo, tipo: p.tipo, comparacao, vendas, vendasComparadas });
}
