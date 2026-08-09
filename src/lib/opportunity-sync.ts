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
    // o cartão GANHO carrega o valor VENDIDO do pedido (sem frete) — ganhar
    // com valor R$ 0/velho fazia o funil e o Dashboard contarem histórias
    // diferentes da mesma venda (auditoria 07/08/2026)
    const pedido = await db.order.findFirst({
      where: { opportunityId, companyId },
      select: { netTotal: true },
    });
    await db.opportunity.updateMany({
      where: { id: opportunityId, companyId, status: { not: "WON" } },
      data: {
        stageId: stage.id,
        status: "WON",
        closedAt: new Date(),
        lastInteractionAt: new Date(),
        ...(pedido ? { value: pedido.netTotal } : {}),
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
    // Última etapa "aberta" ANTES do ganho — a mais próxima de fechar.
    //
    // Antes pegava simplesmente a última etapa aberta da lista, e no funil
    // padrão isso é "Pós-venda" (que vem DEPOIS de "Pedido fechado"). Um
    // pedido estornado voltava para uma etapa que significa "já vendi, estou
    // acompanhando": ninguém cobrava a cliente e o valor entrava na coluna
    // errada. Agora só entram as etapas anteriores ao ganho.
    const abertas = await db.stage.findMany({
      where: { pipeline: { companyId }, isWon: false, isLost: false },
      orderBy: { order: "desc" },
      select: { id: true, order: true },
    });
    const ganho = await db.stage.findFirst({
      where: { pipeline: { companyId }, isWon: true },
      orderBy: { order: "asc" },
      select: { order: true },
    });
    const stage =
      abertas.find((s) => ganho == null || s.order < ganho.order) ?? abertas[0];
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
