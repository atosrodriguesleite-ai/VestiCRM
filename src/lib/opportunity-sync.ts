import { db } from "./db";
import { PAID_ORDER_STATUSES, orderNumber } from "./orders";
import { nomeCasaComEtapa } from "./funil-auto";

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
  opportunityId: string | null,
  /** quando a venda foi paga de verdade (conciliação do passado usa o paidAt
   *  real — sem isso a venda de julho aparecia fechada "hoje" no funil) */
  fechadoEm?: Date | null
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
        closedAt: fechadoEm ?? new Date(),
        lastInteractionAt: fechadoEm ?? new Date(),
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

/**
 * TODO PEDIDO TEM CARTÃO NO FUNIL (13/08/2026).
 *
 * O funil só fechava sozinho quando o pedido JÁ nascia amarrado a uma
 * negociação — e dois caminhos comuns nasciam soltos:
 *   • cliente de sempre pedindo pelo catálogo: o intake reaproveitava a
 *     negociação aberta e o pedido ficava sem vínculo;
 *   • política da loja sem criação automática / Nuvemshop / pedido montado
 *     para cliente sem negociação aberta.
 * Resultado real: "Pedido fechado" mostrava 7 vendas quando havia muito mais.
 *
 * Aqui a regra vira simples: pedido sem cartão GANHA um — reaproveita a
 * negociação aberta livre da cliente ou cria um cartão na etapa certa
 * (pago → etapa de ganho, com a data real do pagamento). Nunca derruba a
 * venda por causa do funil.
 *
 * Devolve o id do cartão amarrado (ou null se não deu).
 */
export async function garantirCartaoDoPedido(
  companyId: string,
  orderId: string
): Promise<string | null> {
  try {
    const order = await db.order.findFirst({
      where: { id: orderId, companyId },
      select: {
        id: true,
        number: true,
        status: true,
        customerId: true,
        sellerId: true,
        netTotal: true,
        paidAt: true,
        createdAt: true,
        opportunityId: true,
        items: { select: { quantity: true } },
      },
    });
    if (!order) return null;
    const pago = (PAID_ORDER_STATUSES as readonly string[]).includes(order.status);
    if (order.opportunityId) {
      // corrida amarrou o cartão entre o snapshot da rota e agora: se o
      // pedido está pago, garante o fechamento (idempotente) antes de sair
      if (pago) await winLinkedOpportunity(companyId, order.opportunityId, order.paidAt);
      return order.opportunityId;
    }
    // cancelado sem cartão: não inventa uma "perda" que nunca foi negociação
    if (order.status === "CANCELADO") return null;
    const quandoPagou = order.paidAt ?? order.createdAt;

    // 1) reaproveita a negociação ABERTA da cliente que ainda não tem pedido —
    //    mas SÓ se ela já existia quando o pedido nasceu (é a mesma venda que
    //    a vendedora vinha trabalhando). Sem essa trava, a conciliação de um
    //    pedido antigo ROUBAVA a negociação nova que a vendedora abriu ontem
    //    e a fechava como ganha (revisão 13/08/2026).
    const livre = await db.opportunity.findFirst({
      where: {
        companyId,
        customerId: order.customerId,
        status: "OPEN",
        order: null,
        createdAt: { lte: order.createdAt },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (livre) {
      const amarrado = await db.order.updateMany({
        where: { id: order.id, companyId, opportunityId: null },
        data: { opportunityId: livre.id },
      });
      if (amarrado.count === 0) return null; // corrida: outro caminho amarrou antes
      if (pago) {
        await winLinkedOpportunity(companyId, livre.id, order.paidAt);
      } else {
        await db.opportunity.update({
          where: { id: livre.id },
          data: { value: order.netTotal, lastInteractionAt: new Date() },
        });
      }
      return livre.id;
    }

    // 1b) venda antiga que a vendedora já FECHOU À MÃO no funil (cartão ganho
    //     sem pedido amarrado, na janela da venda): amarra nele em vez de
    //     criar outro — senão a conciliação DOBRAVA o "Pedido fechado" de
    //     quem sempre usou o funil manualmente (revisão 13/08/2026).
    if (pago) {
      const JANELA = 14 * 24 * 60 * 60 * 1000;
      const fechadoAMao = await db.opportunity.findFirst({
        where: {
          companyId,
          customerId: order.customerId,
          status: "WON",
          order: null,
          closedAt: {
            gte: new Date(quandoPagou.getTime() - JANELA),
            lte: new Date(quandoPagou.getTime() + JANELA),
          },
        },
        orderBy: { closedAt: "desc" },
        select: { id: true },
      });
      if (fechadoAMao) {
        const amarrado = await db.order.updateMany({
          where: { id: order.id, companyId, opportunityId: null },
          data: { opportunityId: fechadoAMao.id },
        });
        if (amarrado.count === 0) return null;
        // o valor passa a ser o VENDIDO do pedido (fonte única do dinheiro)
        await db.opportunity.update({
          where: { id: fechadoAMao.id },
          data: { value: order.netTotal },
        });
        return fechadoAMao.id;
      }
    }

    // 2) não tinha negociação nenhuma → o cartão nasce na etapa certa
    const etapas = await db.stage.findMany({
      where: { pipeline: { companyId } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, isWon: true, isLost: true },
    });
    const stage = pago
      ? etapas.find((s) => s.isWon)
      : (etapas.find((s) =>
          nomeCasaComEtapa(
            s.name,
            order.status === "AGUARDANDO_PAGAMENTO" ? "PAGAMENTO" : "NEGOCIACAO"
          )
        ) ?? etapas.find((s) => !s.isWon && !s.isLost));
    if (!stage) return null;

    const dono =
      order.sellerId ??
      (
        await db.customer.findFirst({
          where: { id: order.customerId, companyId },
          select: { ownerId: true },
        })
      )?.ownerId ??
      null;
    const pecas = order.items.reduce((s, i) => s + i.quantity, 0);
    const opp = await db.opportunity.create({
      data: {
        companyId,
        customerId: order.customerId,
        stageId: stage.id,
        title: `Pedido ${orderNumber(order.number)} — ${pecas} ${pecas === 1 ? "peça" : "peças"}`,
        value: order.netTotal,
        ownerId: dono,
        status: pago ? "WON" : "OPEN",
        closedAt: pago ? (order.paidAt ?? new Date()) : null,
        // o cartão carrega a DATA REAL do pedido: na conciliação do passado o
        // filtro de período do funil conta a venda no dia em que ela existiu
        // (e apagar o pedido leva o cartão junto — nasceram juntos)
        createdAt: order.createdAt,
        lastInteractionAt: order.paidAt ?? order.createdAt,
      },
    });
    const amarrado = await db.order.updateMany({
      where: { id: order.id, companyId, opportunityId: null },
      data: { opportunityId: opp.id },
    });
    if (amarrado.count === 0) {
      // corrida: outro caminho amarrou primeiro → o cartão recém-criado sobrou
      await db.opportunity.delete({ where: { id: opp.id } });
      return null;
    }
    return opp.id;
  } catch {
    /* funil nunca bloqueia venda/pagamento */
    return null;
  }
}

/**
 * CONCILIAÇÃO DE CARONA (roda ao abrir o Funil, sem cron): todo pedido antigo
 * que nasceu sem cartão ganha o seu — pago vira cartão FECHADO com a data real
 * do pagamento; orçamento/aguardando vira cartão aberto na etapa certa. Em
 * rodadas limitadas para nunca pesar a tela; quando não sobra pedido solto,
 * custa uma consulta vazia.
 */
export async function conciliarFunilComPedidos(companyId: string): Promise<void> {
  try {
    // sem etapa de ganho não há onde pendurar venda paga: sai barato AGORA —
    // senão cada abertura do funil varria os mesmos pedidos para sempre
    const temGanho = await db.stage.findFirst({
      where: { pipeline: { companyId }, isWon: true },
      select: { id: true },
    });
    if (!temGanho) return;
    const soltos = await db.order.findMany({
      where: { companyId, opportunityId: null, status: { not: "CANCELADO" } },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: { id: true },
    });
    for (const o of soltos) await garantirCartaoDoPedido(companyId, o.id);
  } catch {
    /* idem: conciliação nunca derruba a tela */
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
