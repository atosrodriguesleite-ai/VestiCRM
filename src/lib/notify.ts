import { db } from "./db";

/**
 * Notificações internas do CRM (sino do topo). Nunca vão ao cliente — são
 * avisos entre a equipe: menção numa nota interna, chamado transferido/
 * atribuído a você, etc.
 */

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Descobre quais usuários da equipe foram mencionados numa nota interna.
 * Casa "@Nome Completo" e "@Primeiro" (o autor da nota é ignorado).
 */
export function parseMentions(
  body: string,
  team: { id: string; name: string }[],
  authorId?: string
): string[] {
  const ids = new Set<string>();
  for (const u of team) {
    if (u.id === authorId) continue;
    const full = escapeRegex(u.name);
    const first = escapeRegex(u.name.split(" ")[0]);
    // nome completo primeiro; senão o primeiro nome com fronteira de palavra
    const re = new RegExp(`@(?:${full}|${first})(?![\\p{L}])`, "iu");
    if (re.test(body)) ids.add(u.id);
  }
  return [...ids];
}

/** Cria notificações de menção para cada usuário citado numa nota interna. */
export async function notifyMentions(input: {
  companyId: string;
  convId: string;
  authorId?: string;
  authorName: string;
  customerName: string;
  note: string;
}) {
  const team = await db.user.findMany({
    where: { companyId: input.companyId, active: true },
    select: { id: true, name: true },
  });
  const mentioned = parseMentions(input.note, team, input.authorId);
  if (mentioned.length === 0) return 0;
  await db.notification.createMany({
    data: mentioned.map((userId) => ({
      companyId: input.companyId,
      userId,
      type: "MENTION",
      title: `${input.authorName.split(" ")[0]} te marcou em ${input.customerName}`,
      body: input.note.slice(0, 160),
      convId: input.convId,
      actorName: input.authorName,
    })),
  });
  return mentioned.length;
}

/**
 * Notifica alguém que um chamado foi atribuído/transferido para ele — só
 * quando quem atribuiu é OUTRA pessoa (assumir o próprio não notifica).
 */
export async function notifyAssignment(input: {
  companyId: string;
  convId: string;
  assigneeId: string;
  actorId?: string;
  actorName: string;
  customerName: string;
}) {
  if (input.assigneeId === input.actorId) return;
  await db.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.assigneeId,
      type: "ASSIGN",
      title: `${input.actorName.split(" ")[0]} transferiu ${input.customerName} para você`,
      body: "Atendimento aguardando na sua caixa de entrada.",
      convId: input.convId,
      actorName: input.actorName,
    },
  });
}
