import { db } from "./db";

/**
 * Sincroniza a oportunidade do funil com o PEDIDO ligado a ela.
 *
 * Antes, pagar ou cancelar um pedido não mexia no funil: a negociação
 * ficava aberta para sempre, somando na etapa errada — os números do
 * Funil não batiam com os Pedidos. Agora o funil acompanha o pedido:
 *   pedido pago      → oportunidade GANHA (etapa de ganho)
 *   pedido cancelado → oportunidade PERDIDA (motivo: pedido cancelado)
 *   pedido reaberto  → oportunidade volta a ABERTA (última etapa aberta)
 *   total editado    → valor da oportunidade acompanha
 *
 * Todas as funções são "melhor esforço": nunca derrubam o fluxo de
 * pagamento/estoque por causa do funil.
 */

export async function winLinkedOpportunity(
  companyId: string,
  opportunityId: string | null
): Promise<void> {
  if (!opportunityId) return;
  try {
    const stage = await db.stage.findFirst({
      where: { pipeline: { companyId }, isWon: true },
    });
    if (!stage) return;
    await db.opportunity.updateMany({
      where: { id: opportunityId, companyId, status: { not: "WON" } },
      data: {
        stageId: stage.id,
        status: "WON",
        closedAt: new Date(),
        lastInteractionAt: new Date(),
      },
    });
  } catch {
    /* funil nunca bloqueia o dinheiro */
  }
}

export async function loseLinkedOpportunity(
  companyId: string,
  opportunityId: string | null
): Promise<void> {
  if (!opportunityId) return;
  try {
    const stage = await db.stage.findFirst({
      where: { pipeline: { companyId }, isLost: true },
    });
    if (!stage) return;
    await db.opportunity.updateMany({
      where: { id: opportunityId, companyId, status: { not: "LOST" } },
      data: {
        stageId: stage.id,
        status: "LOST",
        lostReason: "Pedido cancelado",
        closedAt: new Date(),
        lastInteractionAt: new Date(),
      },
    });
  } catch {
    /* idem */
  }
}

/** Pedido saiu de pago/cancelado sem fechar → negociação volta a correr. */
export async function reopenLinkedOpportunity(
  companyId: string,
  opportunityId: string | null
): Promise<void> {
  if (!opportunityId) return;
  try {
    // última etapa "aberta" do funil (a mais próxima do fechamento)
    const stages = await db.stage.findMany({
      where: { pipeline: { companyId }, isWon: false, isLost: false },
      orderBy: { order: "desc" },
      take: 1,
    });
    const stage = stages[0];
    if (!stage) return;
    await db.opportunity.updateMany({
      where: { id: opportunityId, companyId, status: { not: "OPEN" } },
      data: {
        stageId: stage.id,
        status: "OPEN",
        closedAt: null,
        lostReason: null,
        lastInteractionAt: new Date(),
      },
    });
  } catch {
    /* idem */
  }
}

/** Itens do pedido editados → o valor no funil acompanha o novo total. */
export async function syncOpportunityValue(
  companyId: string,
  opportunityId: string | null,
  total: number
): Promise<void> {
  if (!opportunityId) return;
  try {
    await db.opportunity.updateMany({
      where: { id: opportunityId, companyId },
      data: { value: total },
    });
  } catch {
    /* idem */
  }
}
