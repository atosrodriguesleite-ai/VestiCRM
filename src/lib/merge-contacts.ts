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
    select: { id: true },
  });
  if (convs.length <= 1) return 0;
  const [target, ...extras] = convs;
  await db.$transaction(async (tx) => {
    for (const c of extras) {
      await tx.message.updateMany({
        where: { conversationId: c.id },
        data: { conversationId: target.id },
      });
      await tx.order.updateMany({
        where: { conversationId: c.id },
        data: { conversationId: target.id },
      });
      await tx.conversation.delete({ where: { id: c.id } });
    }
    await tx.conversation.update({
      where: { id: target.id },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });
  });
  return extras.length;
}

/** Repõe todos os vínculos de um cliente duplicado no cliente principal. */
async function repointCustomer(
  tx: Prisma.TransactionClient,
  primaryId: string,
  dupeId: string
) {
  // vínculos simples (sem chave composta): basta repontar
  await tx.customerEvent.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.opportunity.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.conversation.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.task.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.sale.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.order.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });
  await tx.trackSession.updateMany({ where: { customerId: dupeId }, data: { customerId: primaryId } });

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
  // envios de campanha (unique campaignId+customerId): mantém o do principal
  await tx.campaignSend.deleteMany({ where: { customerId: dupeId } });

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
