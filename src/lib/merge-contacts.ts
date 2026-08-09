import { db } from "./db";
import type { Prisma } from "@prisma/client";

/**
 * Unificação de contatos e conversas duplicados.
 *
 * Causa raiz: número de celular BR pode chegar com o 9º dígito (55 DD 9XXXXXXXX)
 * ou sem (55 DD XXXXXXXX). Antes disso ser tratado, a mesma pessoa virava dois
 * cadastros e/ou duas conversas. Aqui a gente junta tudo num só, sem perder
 * histórico (mensagens, pedidos, oportunidades, tarefas... são repontados).
 */

/** Chave canônica do telefone: ignora o 9º dígito para agrupar a mesma pessoa. */
export function canonicalPhone(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  const n = d.length === 10 || d.length === 11 ? "55" + d : d;
  if (n.startsWith("55") && n.length >= 12) {
    const ddd = n.slice(2, 4);
    const sub = n.slice(4);
    if (sub.length === 9 && sub.startsWith("9")) return `55${ddd}${sub.slice(1)}`;
  }
  return n;
}

/**
 * Junta as conversas ABERTAS de um mesmo cliente numa só (a de atividade mais
 * recente), movendo mensagens e pedidos. Seguro: não apaga cliente, só une
 * conversas do próprio cliente. Devolve quantas conversas foram fundidas.
 */
export async function consolidateOpenConversations(
  companyId: string,
  customerId: string
): Promise<number> {
  const convs = await db.conversation.findMany({
    where: { companyId, customerId, status: { not: "CLOSED" } },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, assigneeId: true, setorId: true, unreadCount: true },
  });
  if (convs.length <= 1) return 0;
  const [target, ...extras] = convs;
  await db.$transaction(async (tx) => {
    // a MESMA mensagem do WhatsApp pode existir nas duas conversas (entrega
    // duplicada antes da unificação). Mover por cima estourava o índice
    // único (conversationId, externalId) e ABORTAVA a unificação inteira —
    // aqui a cópia repetida é descartada antes de mover (auditoria
    // 07/08/2026).
    const doAlvo = await tx.message.findMany({
      where: { conversationId: target.id, externalId: { not: null } },
      select: { externalId: true },
    });
    const jaNoAlvo = new Set(doAlvo.map((m) => m.externalId as string));
    for (const c of extras) {
      const comExterno = await tx.message.findMany({
        where: { conversationId: c.id, externalId: { not: null } },
        select: { id: true, externalId: true },
      });
      const repetidas = comExterno.filter((m) => jaNoAlvo.has(m.externalId as string));
      if (repetidas.length) {
        await tx.message.deleteMany({ where: { id: { in: repetidas.map((m) => m.id) } } });
      }
      for (const m of comExterno) {
        if (m.externalId) jaNoAlvo.add(m.externalId);
      }
      await tx.message.updateMany({
        where: { conversationId: c.id },
        data: { conversationId: target.id },
      });
      await tx.order.updateMany({
        where: { conversationId: c.id },
        data: { conversationId: target.id },
      });
      // o sino continua abrindo a conversa certa depois da fusão
      await tx.notification.updateMany({
        where: { convId: c.id },
        data: { convId: target.id },
      });
      await tx.conversation.delete({ where: { id: c.id } });
    }
    await tx.conversation.update({
      where: { id: target.id },
      data: {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        // atendimento não se perde: a conversa que fica herda a dona e o
        // setor das extras quando não tem, e as não-lidas se somam
        assigneeId: target.assigneeId ?? extras.find((e) => e.assigneeId)?.assigneeId ?? null,
        setorId: target.setorId ?? extras.find((e) => e.setorId)?.setorId ?? null,
        unreadCount: extras.reduce((s, e) => s + e.unreadCount, target.unreadCount),
      },
    });
  });
  return extras.length;
}

/** Nome que não é nome de gente: placeholder do sistema ou telefone puro. */
function nomeGenerico(nome: string | null | undefined): boolean {
  const n = (nome ?? "").trim();
  if (!n) return true;
  if (/^cliente (da loja|do cat[aá]logo)/i.test(n)) return true;
  return /^\+?[\d\s()./-]+$/.test(n); // só dígitos/pontuação = telefone no lugar do nome
}

/** Repõe todos os vínculos de um cliente duplicado no cliente principal. */
async function repointCustomer(
  tx: Prisma.TransactionClient,
  primaryId: string,
  dupeId: string
) {
  // A FICHA SE COMPLETA ANTES DE APAGAR (auditoria 07/08/2026): o principal é
  // o cadastro mais ANTIGO — muitas vezes o mais pobre. Apagar o duplicado
  // sem copiar os dados jogava fora nome real, CPF, endereço, aniversário,
  // anotações, campanha e foto que só existiam no mais novo. Regra: o que o
  // principal NÃO tem vem do duplicado; o que ele já tem, fica.
  const [principal, dupe] = await Promise.all([
    tx.customer.findUnique({ where: { id: primaryId } }),
    tx.customer.findUnique({ where: { id: dupeId } }),
  ]);
  if (principal && dupe) {
    const puxa = <K extends keyof typeof principal>(campo: K) =>
      principal[campo] == null || principal[campo] === ""
        ? { [campo]: dupe[campo] }
        : {};
    await tx.customer.update({
      where: { id: primaryId },
      data: {
        // nome de verdade vence o placeholder ("Cliente do catálogo…")
        ...(nomeGenerico(principal.name) && !nomeGenerico(dupe.name)
          ? { name: dupe.name }
          : {}),
        ...puxa("email"),
        ...puxa("cpf"),
        ...puxa("cnpj"),
        ...puxa("zip"),
        ...puxa("street"),
        ...puxa("streetNumber"),
        ...puxa("complement"),
        ...puxa("district"),
        ...puxa("city"),
        ...puxa("state"),
        ...puxa("preferredSize"),
        ...puxa("preferredColors"),
        ...puxa("birthDate"),
        ...puxa("resaleStoreName"),
        ...puxa("photoUrl"),
        ...puxa("photoSyncAt"),
        ...puxa("ownerId"),
        ...puxa("campaignId"),
        ...puxa("adRef"),
        ...puxa("landingSource"),
        ...puxa("affiliateId"),
        // anotações não se perdem: as duas ficam, separadas
        ...(dupe.notes && principal.notes && dupe.notes !== principal.notes
          ? { notes: `${principal.notes}\n---\n${dupe.notes}` }
          : puxa("notes")),
        // lojista uma vez, lojista sempre: ATACADO vence o padrão VAREJO
        ...(principal.type === "VAREJO" && dupe.type === "ATACADO"
          ? { type: "ATACADO" as const }
          : {}),
        // datas de atividade: vale a mais recente das duas
        ...(dupe.lastPurchaseAt &&
        (!principal.lastPurchaseAt || dupe.lastPurchaseAt > principal.lastPurchaseAt)
          ? { lastPurchaseAt: dupe.lastPurchaseAt }
          : {}),
        ...(dupe.lastContactAt &&
        (!principal.lastContactAt || dupe.lastContactAt > principal.lastContactAt)
          ? { lastContactAt: dupe.lastContactAt }
          : {}),
      },
    });
  }

  // vínculos simples (sem chave composta): basta repontar
  await tx.customerEvent.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.opportunity.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.conversation.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.task.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.sale.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.order.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.trackSession.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  // o VISITANTE do tracking também acompanha — sem isto o id apagado ficava
  // fantasma na Inteligência ("Identificados" contava cliente que não existe)
  await tx.visitor.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });

  // vínculos com chave composta: copia sem conflito e apaga os do duplicado
  const tags = await tx.customerTag.findMany({ where: { customerId: dupeId }, select: { tagId: true } });
  if (tags.length) {
    await tx.customerTag.createMany({
      data: tags.map((t) => ({ customerId: primaryId, tagId: t.tagId })),
      skipDuplicates: true,
    });
    await tx.customerTag.deleteMany({ where: { customerId: dupeId } });
  }
  const interests = await tx.customerInterest.findMany({ where: { customerId: dupeId }, select: { interestId: true } });
  if (interests.length) {
    await tx.customerInterest.createMany({
      data: interests.map((i) => ({ customerId: primaryId, interestId: i.interestId })),
      skipDuplicates: true,
    });
    await tx.customerInterest.deleteMany({ where: { customerId: dupeId } });
  }
  // a sacola abandonada acompanha (o apagar do cliente soltava o vínculo e a
  // sacola virava órfã — sumia da esteira de recuperação)
  await tx.abandonedCart.updateMany({
    where: { customerId: dupeId },
    data: { customerId: primaryId },
  });

  // envios de campanha: o HISTÓRICO se preserva (apagar fazia a cliente
  // receber a MESMA campanha de novo). Repontamos um a um; quando o
  // principal já recebeu aquela campanha, a linha repetida é descartada.
  const envios = await tx.campaignSend.findMany({
    where: { customerId: dupeId },
    select: { id: true, campaignId: true },
  });
  for (const e of envios) {
    const jaRecebeu = await tx.campaignSend.findUnique({
      where: { campaignId_customerId: { campaignId: e.campaignId, customerId: primaryId } },
      select: { id: true },
    });
    if (jaRecebeu) await tx.campaignSend.delete({ where: { id: e.id } });
    else await tx.campaignSend.update({ where: { id: e.id }, data: { customerId: primaryId } });
  }

  await tx.customer.delete({ where: { id: dupeId } });
}

export type MergePreview = {
  gruposDuplicados: number; // quantos números têm mais de um cadastro
  cadastrosARemover: number; // total de cadastros que serão fundidos
};

/**
 * Encontra (e opcionalmente une) contatos duplicados de uma empresa pela chave
 * canônica do telefone. Sem apply → só devolve a prévia (não altera nada).
 */
export async function mergeDuplicateContacts(
  companyId: string,
  apply: boolean
): Promise<MergePreview> {
  const customers = await db.customer.findMany({
    where: { companyId },
    select: { id: true, phone: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const grupos = new Map<string, { id: string }[]>();
  for (const c of customers) {
    const key = canonicalPhone(c.phone);
    if (!key || key.length < 8) continue; // ignora telefone vazio/curto
    const arr = grupos.get(key) ?? [];
    arr.push({ id: c.id });
    grupos.set(key, arr);
  }

  let gruposDuplicados = 0;
  let cadastrosARemover = 0;
  const paraUnir: { primary: string; dupes: string[] }[] = [];
  for (const arr of grupos.values()) {
    if (arr.length <= 1) continue;
    gruposDuplicados++;
    cadastrosARemover += arr.length - 1;
    const [primary, ...dupes] = arr; // o mais antigo é o principal (order asc)
    paraUnir.push({ primary: primary.id, dupes: dupes.map((d) => d.id) });
  }

  if (apply) {
    for (const g of paraUnir) {
      await db.$transaction(async (tx) => {
        for (const dupeId of g.dupes) await repointCustomer(tx, g.primary, dupeId);
      });
      // depois de juntar os cadastros, junta as conversas abertas do principal
      await consolidateOpenConversations(companyId, g.primary);
    }

    // faxina final: padroniza o telefone dos cadastros que sobraram (só
    // dígitos, com DDI 55). Telefone salvo com formatação ou sem DDI era o
    // furo que impedia o WhatsApp de casar com o cadastro e criava duplicado.
    // Seguro rodar DEPOIS da unificação: números iguais já viraram um só.
    const restantes = await db.customer.findMany({
      where: { companyId },
      select: { id: true, phone: true },
    });
    for (const c of restantes) {
      if (!c.phone || /[a-z]/i.test(c.phone)) continue; // marcadores ("ns-123") ficam
      let norm = c.phone.replace(/\D/g, "");
      if (norm.length === 10 || norm.length === 11) norm = "55" + norm;
      if (norm.length >= 10 && norm !== c.phone) {
        await db.customer.update({ where: { id: c.id }, data: { phone: norm } });
      }
    }
  }

  return { gruposDuplicados, cadastrosARemover };
}
