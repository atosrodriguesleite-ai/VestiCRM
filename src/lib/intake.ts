import { db } from "./db";
import { originLabel } from "./format";
import { consolidateOpenConversations } from "./merge-contacts";
import type { Origin, Customer, Conversation, Opportunity, Task } from "@prisma/client";

/**
 * Lead Intake Engine — camada ÚNICA de entrada de leads (omnichannel).
 *
 * Toda integração (WhatsApp, catálogo público, Instagram, Facebook, site,
 * Nuvemshop, Bling, marketplace, cadastro manual...) DEVE passar por aqui.
 * Nenhum canal cria clientes diretamente — isso garante:
 *   • deduplicação por telefone (nenhum cliente duplicado);
 *   • conversa criada/reaproveitada;
 *   • oportunidade na etapa configurada para a origem;
 *   • tarefa de primeiro atendimento dentro do SLA;
 *   • distribuição automática (vendedor fixo ou rodízio);
 *   • evento na timeline com total rastreabilidade.
 */

export type IntakePayload = {
  phone: string;
  name?: string;
  origin: Origin;
  message?: string; // primeira mensagem recebida (vira mensagem IN na conversa)
  city?: string;
  state?: string;
  opportunityTitle?: string;
  value?: number;
  ownerId?: string; // força o responsável (ex.: cadastro manual pelo vendedor)
  campaignId?: string; // campanha de aquisição (módulo Marketing) — atribuição
  skipTask?: boolean;
  skipOpportunity?: boolean; // quando a oportunidade será criada manualmente em seguida
};

export type IntakeResult = {
  customer: Customer;
  conversation: Conversation | null;
  opportunity: Opportunity | null;
  task: Task | null;
  isNewLead: boolean;
};

/** Normaliza telefone para o formato de armazenamento (dígitos, com DDI 55). */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

/**
 * Variações do MESMO número brasileiro para dedup, tolerando o "9º dígito":
 * um celular pode aparecer com 9 (55 DD 9XXXXXXXX) ou sem (55 DD XXXXXXXX) —
 * o WhatsApp costuma mandar com 9, e cadastros antigos ficam sem. Assim a
 * mesma pessoa não vira dois contatos/duas conversas.
 */
export function phoneMatchVariants(raw: string): string[] {
  const d = normalizePhone(raw);
  const set = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const sub = d.slice(4); // parte após DDI+DDD
    if (sub.length === 9 && sub.startsWith("9")) set.add(`55${ddd}${sub.slice(1)}`); // tira o 9
    if (sub.length === 8) set.add(`55${ddd}9${sub}`); // põe o 9
  }
  return [...set];
}

/** Rodízio: próximo vendedor ativo depois do último que recebeu lead. */
export function pickRoundRobin<T extends { id: string }>(
  sellers: T[],
  lastId: string | null
): T | null {
  if (sellers.length === 0) return null;
  const idx = sellers.findIndex((s) => s.id === lastId);
  return sellers[(idx + 1) % sellers.length];
}

async function resolveOwner(companyId: string, forced?: string) {
  if (forced) return forced;
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return null;

  if (company.intakeDistribution === "FIXED" && company.intakeDefaultUserId) {
    const fixed = await db.user.findFirst({
      where: { id: company.intakeDefaultUserId, companyId, active: true },
    });
    if (fixed) return fixed.id;
  }

  const sellers = await db.user.findMany({
    where: { companyId, active: true, role: "SELLER" },
    orderBy: { createdAt: "asc" },
  });
  const pool = sellers.length
    ? sellers
    : await db.user.findMany({
        where: { companyId, active: true, role: { not: "SUPERADMIN" } },
        orderBy: { createdAt: "asc" },
      });
  const next = pickRoundRobin(pool, company.intakeLastUserId);
  if (next) {
    await db.company.update({
      where: { id: companyId },
      data: { intakeLastUserId: next.id },
    });
  }
  return next?.id ?? null;
}

async function resolveStage(companyId: string, origin: Origin) {
  const rule = await db.originRule.findUnique({
    where: { companyId_origin: { companyId, origin } },
    include: { stage: true },
  });
  if (rule?.stage) return rule.stage;
  return db.stage.findFirst({
    where: { pipeline: { companyId } },
    orderBy: { order: "asc" },
  });
}

export async function intakeLead(
  companyId: string,
  payload: IntakePayload
): Promise<IntakeResult> {
  const phone = normalizePhone(payload.phone);
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error("Empresa não encontrada");

  // dedup tolerante ao 9º dígito (com/sem 9) — evita cliente/conversa duplicados
  const existing = await db.customer.findFirst({
    where: { companyId, phone: { in: phoneMatchVariants(payload.phone) } },
    orderBy: { createdAt: "asc" },
  });

  const channelLabel = originLabel[payload.origin];
  let customer: Customer;
  let isNewLead = false;

  if (existing) {
    // ---- Cliente já existe: reutiliza cadastro e registra a interação ----
    customer = await db.customer.update({
      where: { id: existing.id },
      data: {
        lastContactAt: new Date(),
        ...(payload.name && !existing.name ? { name: payload.name } : {}),
        // atribuição "primeiro contato": só grava a campanha se ainda não há
        ...(payload.campaignId && !existing.campaignId
          ? { campaignId: payload.campaignId }
          : {}),
      },
    });
    await db.customerEvent.create({
      data: {
        companyId,
        customerId: customer.id,
        type: "NOVA_INTERACAO",
        channel: payload.origin,
        description: `Nova interação via ${channelLabel}`,
      },
    });
  } else {
    // ---- Lead novo: cria com origem e responsável distribuído ----
    isNewLead = true;
    const ownerId = await resolveOwner(companyId, payload.ownerId);
    customer = await db.customer.create({
      data: {
        companyId,
        name: payload.name?.trim() || `Lead ${phone.slice(-4)}`,
        phone,
        city: payload.city,
        state: payload.state,
        origin: payload.origin,
        campaignId: payload.campaignId ?? null,
        ownerId,
        lastContactAt: payload.message ? new Date() : null,
      },
    });
    await db.customerEvent.create({
      data: {
        companyId,
        customerId: customer.id,
        type: "LEAD_CRIADO",
        channel: payload.origin,
        description:
          payload.origin === "MANUAL"
            ? "Lead criado manualmente"
            : `Lead criado via ${channelLabel}`,
      },
    });
  }

  // ---- Conversa: reutiliza a aberta ou cria uma nova ----
  // antes, junta eventuais conversas abertas duplicadas deste cliente numa só
  // (auto-cura: a mesma pessoa nunca mostra dois chats abertos na fila)
  await consolidateOpenConversations(companyId, customer.id);
  let conversation = await db.conversation.findFirst({
    where: { companyId, customerId: customer.id, status: { not: "CLOSED" } },
    orderBy: { lastMessageAt: "desc" },
  });
  // HISTÓRICO É SAGRADO: cliente que volta depois de um atendimento
  // encerrado REABRE a mesma conversa (com todo o histórico) e cai na fila.
  // Antes nascia um chat NOVO vazio e o histórico ficava "escondido" na
  // conversa encerrada — parecia que a conversa tinha sumido.
  if (!conversation && (payload.message || isNewLead)) {
    const encerrada = await db.conversation.findFirst({
      where: { companyId, customerId: customer.id, status: "CLOSED" },
      orderBy: { lastMessageAt: "desc" },
    });
    if (encerrada) {
      conversation = await db.conversation.update({
        where: { id: encerrada.id },
        data: { status: "OPEN", assigneeId: payload.ownerId ?? null },
      });
    }
  }
  if (!conversation && (payload.message || isNewLead)) {
    // Central de Atendimento (modelo Digisac): o chamado NÃO nasce com dono —
    // entra na FILA do setor (assigneeId null) para um vendedor "assumir".
    // O dono do CLIENTE (customer.ownerId) continua existindo para o CRM;
    // quem atende ESTA conversa é decidido na fila. Se o próprio vendedor
    // criou o lead manualmente (payload.ownerId), já assume o atendimento.
    conversation = await db.conversation.create({
      data: {
        companyId,
        customerId: customer.id,
        assigneeId: payload.ownerId ?? null,
        status: "OPEN",
      },
    });
  }
  if (conversation && payload.message) {
    await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: "IN",
        body: payload.message,
      },
    });
    conversation = await db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        unreadCount: { increment: 1 },
        status: "OPEN",
      },
    });
  }

  // ---- Oportunidade conforme a política da empresa ----
  let opportunity: Opportunity | null = null;
  const policy = company.intakeOppPolicy;
  const hasOpen = await db.opportunity.findFirst({
    where: { companyId, customerId: customer.id, status: "OPEN" },
  });
  const shouldCreateOpp =
    !payload.skipOpportunity &&
    (policy === "SEMPRE" || (policy === "SE_NAO_HOUVER_ABERTA" && !hasOpen));
  if (shouldCreateOpp) {
    const stage = await resolveStage(companyId, payload.origin);
    if (stage) {
      opportunity = await db.opportunity.create({
        data: {
          companyId,
          customerId: customer.id,
          stageId: stage.id,
          title:
            payload.opportunityTitle ??
            `Novo contato via ${channelLabel}`,
          value: payload.value ?? 0,
          ownerId: customer.ownerId,
          status: stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN",
        },
      });
      await db.customerEvent.create({
        data: {
          companyId,
          customerId: customer.id,
          type: "OPORTUNIDADE",
          channel: payload.origin,
          description: `Oportunidade criada na etapa "${stage.name}"`,
        },
      });
    }
  }

  // ---- Tarefa de primeiro atendimento dentro do SLA ----
  let task: Task | null = null;
  if (isNewLead && !payload.skipTask) {
    task = await db.task.create({
      data: {
        companyId,
        customerId: customer.id,
        opportunityId: opportunity?.id,
        title: `Primeiro atendimento — ${customer.name}`,
        type: "LIGAR",
        priority: "ALTA",
        dueAt: new Date(Date.now() + company.intakeSlaMinutes * 60 * 1000),
        assigneeId: customer.ownerId,
        autoRule: `intake:${customer.id}`,
      },
    });
  }

  return { customer, conversation, opportunity, task, isNewLead };
}
