import { db } from "./db";
import { ownedScope } from "./scope";
import type { SessionUser } from "./auth";
import type { TaskType, TaskPriority } from "@prisma/client";
import { daysSince } from "./format";

export type AutomationSuggestion = {
  /** chave estável: regra + entidade — usada para não duplicar tarefas */
  key: string;
  rule: string;
  title: string;
  description: string;
  customerId: string;
  customerName: string;
  opportunityId?: string;
  taskType: TaskType;
  priority: TaskPriority;
};

/**
 * Motor de automação comercial (item 7 do produto).
 * As regras rodam sobre os dados atuais e geram sugestões de tarefa.
 * Ao "aplicar", criamos uma Task com autoRule = key (idempotente).
 */
export async function computeAutomations(
  user: SessionUser
): Promise<AutomationSuggestion[]> {
  const scope = ownedScope(user);
  const suggestions: AutomationSuggestion[] = [];
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  // Regra 1 — cliente sem resposta há 2+ dias em conversa aguardando cliente
  const staleConvs = await db.conversation.findMany({
    where: {
      companyId: user.companyId,
      status: "WAITING_CLIENT",
      lastMessageAt: { lt: days(2) },
      ...(scope.ownerId ? { assigneeId: user.id } : {}),
    },
    include: { customer: true },
  });
  for (const c of staleConvs) {
    suggestions.push({
      key: `sem-resposta:${c.id}`,
      rule: "Cliente sem resposta há 2+ dias",
      title: `Fazer follow-up com ${c.customer.name}`,
      description: `Última mensagem ${daysSince(c.lastMessageAt)} dias atrás. Retome a conversa antes de esfriar.`,
      customerId: c.customerId,
      customerName: c.customer.name,
      taskType: "FOLLOW_UP",
      priority: "ALTA",
    });
  }

  // Regra 2 — catálogo enviado e sem avanço há 3+ dias
  const catalogOpps = await db.opportunity.findMany({
    where: {
      ...scope,
      status: "OPEN",
      stage: { name: "Catálogo enviado" },
      lastInteractionAt: { lt: days(3) },
    },
    include: { customer: true },
  });
  for (const o of catalogOpps) {
    suggestions.push({
      key: `catalogo-parado:${o.id}`,
      rule: "Recebeu catálogo e não comprou",
      title: `Retomar negociação com ${o.customer.name}`,
      description: `Catálogo enviado há ${daysSince(o.lastInteractionAt)} dias sem resposta. Pergunte o que achou das peças.`,
      customerId: o.customerId,
      customerName: o.customer.name,
      opportunityId: o.id,
      taskType: "FOLLOW_UP",
      priority: "MEDIA",
    });
  }

  // Regra 3 — comprou há 30+ dias: sugerir recompra
  const rebuyCustomers = await db.customer.findMany({
    where: {
      ...scope,
      lastPurchaseAt: { lt: days(30), gt: days(90) },
      opportunities: { none: { status: "OPEN" } },
    },
  });
  for (const c of rebuyCustomers) {
    suggestions.push({
      key: `recompra:${c.id}`,
      rule: "Comprou há 30+ dias",
      title: `Oferecer novidades para ${c.name}`,
      description: `Última compra ${daysSince(c.lastPurchaseAt!)} dias atrás. Envie os lançamentos e sugira recompra.`,
      customerId: c.id,
      customerName: c.name,
      taskType: "ENVIAR_NOVIDADES",
      priority: "MEDIA",
    });
  }

  // Regra 4 — negociação perdida: campanha de reativação
  const lostOpps = await db.opportunity.findMany({
    where: { ...scope, status: "LOST", closedAt: { gt: days(60) } },
    include: { customer: true },
  });
  for (const o of lostOpps) {
    suggestions.push({
      key: `reativar-perdido:${o.id}`,
      rule: "Negociação perdida",
      title: `Reativar ${o.customer.name}`,
      description: `Negociação "${o.title}" foi perdida${o.lostReason ? ` (${o.lostReason})` : ""}. Inclua em campanha de reativação.`,
      customerId: o.customerId,
      customerName: o.customer.name,
      opportunityId: o.id,
      taskType: "REATIVAR",
      priority: "BAIXA",
    });
  }

  // Regra 5 — cliente novo sem primeiro contato
  const newCustomers = await db.customer.findMany({
    where: {
      ...scope,
      createdAt: { gt: days(3) },
      lastContactAt: null,
      tasks: { none: {} },
    },
  });
  for (const c of newCustomers) {
    suggestions.push({
      key: `primeiro-contato:${c.id}`,
      rule: "Cliente novo",
      title: `Primeiro contato com ${c.name}`,
      description: "Lead novo sem nenhum contato registrado. Faça a primeira abordagem hoje.",
      customerId: c.id,
      customerName: c.name,
      taskType: "LIGAR",
      priority: "ALTA",
    });
  }

  // Regra 6 — pedido fechado sem pós-venda
  const wonOpps = await db.opportunity.findMany({
    where: {
      ...scope,
      status: "WON",
      closedAt: { gt: days(14) },
      tasks: { none: { type: "POS_VENDA" } },
    },
    include: { customer: true },
  });
  for (const o of wonOpps) {
    suggestions.push({
      key: `pos-venda:${o.id}`,
      rule: "Pedido fechado",
      title: `Pós-venda com ${o.customer.name}`,
      description: `Pedido "${o.title}" fechado. Confirme se chegou bem e peça feedback das peças.`,
      customerId: o.customerId,
      customerName: o.customer.name,
      opportunityId: o.id,
      taskType: "POS_VENDA",
      priority: "MEDIA",
    });
  }

  // remove sugestões já aplicadas (task com o mesmo autoRule)
  const applied = await db.task.findMany({
    where: {
      companyId: user.companyId,
      autoRule: { in: suggestions.map((s) => s.key) },
    },
    select: { autoRule: true },
  });
  const appliedSet = new Set(applied.map((t) => t.autoRule));
  return suggestions.filter((s) => !appliedSet.has(s.key));
}
