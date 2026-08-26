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
  // primeiro nome repetido na equipe (duas "Ana"): mencionar "@Ana" é
  // ambíguo e notificava as DUAS — nesse caso só o nome completo menciona
  const contagemPrimeiro = new Map<string, number>();
  for (const u of team) {
    const primeiro = u.name.split(" ")[0].toLowerCase();
    contagemPrimeiro.set(primeiro, (contagemPrimeiro.get(primeiro) ?? 0) + 1);
  }
  for (const u of team) {
    if (u.id === authorId) continue;
    const full = escapeRegex(u.name);
    const first = escapeRegex(u.name.split(" ")[0]);
    const ambiguo = (contagemPrimeiro.get(u.name.split(" ")[0].toLowerCase()) ?? 0) > 1;
    // fronteira ANTES do @ também: "contato@Joao" é e-mail, não menção
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])@(?:${full}${ambiguo ? "" : `|${first}`})(?![\\p{L}])`,
      "iu"
    );
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

/**
 * PEDIDO NOVO DO CATÁLOGO — avisa na hora.
 *
 * Até aqui, pedido que entrava pelo catálogo não avisava ninguém: a
 * vendedora só descobria se abrisse a tela Pedidos por acaso. Foi assim que
 * uma loja recebeu o pedido no WhatsApp e jurou que "não chegou no sistema".
 *
 * Para quem vai o aviso (a mesma régua da comissão, sem exceção):
 *  • pedido com vendedora no link → só para ela; é a venda dela;
 *  • pedido SEM vendedora (link geral da loja) → para gerência/admin, que é
 *    quem enxerga pedido sem dona. Nunca para uma vendedora qualquer: o
 *    painel de cada uma tem exatamente os pedidos do link dela.
 */
export async function notifyNovoPedido(input: {
  companyId: string;
  orderId: string;
  orderNumber: string;
  sellerId: string | null;
  convId?: string | null;
  customerName: string;
  pieces: number;
  total: string;
}) {
  const destinos = input.sellerId
    ? [input.sellerId]
    : (
        await db.user.findMany({
          where: {
            companyId: input.companyId,
            role: { in: ["ADMIN", "MANAGER"] },
            active: true,
          },
          select: { id: true },
        })
      ).map((u) => u.id);
  if (destinos.length === 0) return 0;

  const semDona = !input.sellerId;
  await db.notification.createMany({
    data: destinos.map((userId) => ({
      companyId: input.companyId,
      userId,
      type: "PEDIDO",
      title: semDona
        ? `Pedido ${input.orderNumber} chegou SEM vendedora`
        : `Pedido novo ${input.orderNumber} — ${input.customerName}`,
      body: semDona
        ? `${input.customerName} · ${input.pieces} ${input.pieces === 1 ? "peça" : "peças"} · ${input.total}. Veio pelo link geral do catálogo — defina quem vai atender.`
        : `${input.pieces} ${input.pieces === 1 ? "peça" : "peças"} · ${input.total}. Chegou pelo seu link do catálogo.`,
      orderId: input.orderId,
      convId: input.convId ?? null,
    })),
  });
  return destinos.length;
}

/**
 * A cliente preencheu o formulário "Dados de envio" (RN-024): avisa a dona
 * da carteira — sem dona, a gerência (mesma régua do pedido sem vendedora).
 * `mudancas` já vem em linguagem de gente ("endereço atualizado, CPF novo").
 */
export async function notifyDadosRecebidos(input: {
  companyId: string;
  customerName: string;
  ownerId: string | null;
  convId?: string | null;
  mudancas: string;
}) {
  const destinos = input.ownerId
    ? [input.ownerId]
    : (
        await db.user.findMany({
          where: {
            companyId: input.companyId,
            role: { in: ["ADMIN", "MANAGER"] },
            active: true,
          },
          select: { id: true },
        })
      ).map((u) => u.id);
  if (destinos.length === 0) return 0;

  await db.notification.createMany({
    data: destinos.map((userId) => ({
      companyId: input.companyId,
      userId,
      type: "CADASTRO",
      title: `${input.customerName} preencheu os dados de envio 📦`,
      body: input.mudancas,
      convId: input.convId ?? null,
    })),
  });
  return destinos.length;
}
