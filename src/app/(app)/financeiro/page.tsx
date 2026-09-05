import { after } from "next/server";
import { porteiraFinanceiroTela } from "@/lib/financeiro/gate";
import { garantirCategoriasPadrao } from "@/lib/financeiro/cadastros";
import { garantirRecorrencias } from "@/lib/financeiro/recorrencia";
import { repescarSemQuebrar } from "@/lib/financeiro/porta-vendas";
import { PainelFinanceiro } from "./_visao/painel";

export const dynamic = "force-dynamic";

/**
 * FINANCEIRO · VISÃO GERAL (RN-029, RN-035) — o painel de dono do módulo.
 *
 * Só existe para a loja com o módulo: sem a chave, a porteira devolve ao
 * Dashboard e a aba nem aparece no menu. A tela simples de "pedidos a
 * receber", que ficava aqui para toda loja, saiu a pedido do dono
 * (05/09/2026): financeiro pela metade confundia mais do que ajudava.
 */
export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await porteiraFinanceiroTela();
  await garantirCategoriasPadrao(user.companyId);
  await garantirRecorrencias(user.companyId);
  // RN-033: as vendas pagas que ficaram sem baixa por falta de conta padrão
  // são acertadas DE CARONA no tráfego (ADR-002: nunca um 3º cron). Na
  // esmagadora maioria das vezes não há nada a fazer e sai numa consulta só,
  // e ela vai no after(): é trabalho de carona, não pode SEGURAR a tela.
  // Duas abas ao mesmo tempo não pagam nada em dobro (o índice parcial da
  // baixa automática recusa a segunda).
  after(() => repescarSemQuebrar(user.companyId));
  const sp = await searchParams;
  const bruto = Number(Array.isArray(sp.dias) ? sp.dias[0] : sp.dias);
  const dias = [7, 15, 30].includes(bruto) ? bruto : 30;
  return <PainelFinanceiro companyId={user.companyId} dias={dias} />;
}
