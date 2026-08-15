import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { conversationScope, isManagerUp } from "@/lib/scope";
import { notifyAssignment } from "@/lib/notify";
import { contadorAoMarcarNaoLida } from "@/lib/comm/fila";
import { loadInboxConversations } from "@/lib/inbox-data";

/**
 * UMA conversa com o histórico recente COMPLETO.
 *
 * O sync entrega só o que MUDOU desde a última consulta — ótimo para quem já
 * tem a conversa na tela, péssimo para quem não tem: a conversa aparecia com
 * uma mensagem só, como se o atendimento nunca tivesse acontecido. A tela
 * chama aqui quando recebe uma conversa que ainda não conhece.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const [conversa] = await loadInboxConversations(user, undefined, id);
    if (!conversa) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ conversation: conversa });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  status: z
    .enum(["OPEN", "WAITING_CLIENT", "WAITING_PAYMENT", "CLOSED"])
    .optional(),
  priority: z.enum(["BAIXA", "NORMAL", "ALTA"]).optional(),
  assigneeId: z.string().nullable().optional(),
  setorId: z.string().nullable().optional(), // setor do chamado (transferência)
  markRead: z.boolean().optional(),
  /** "volto nessa depois": devolve o marcador de não lida à conversa */
  markUnread: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    // ESCOPO: vendedora só mexe na conversa dela ou na fila (mesma régua da
    // leitura). Sem isto, conversa transferida que "lingava" na tela dela
    // ainda podia ser assumida/encerrada por ela (auditoria 07/08/2026).
    const conv = await db.conversation.findFirst({
      where: { id, ...conversationScope(user) },
      include: { customer: { select: { name: true } } },
    });
    if (!conv) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    // TRANSFERIR para OUTRA pessoa (não assumir para si, não devolver à fila)
    // é decisão de gerência — senão uma vendedora empurra o atendimento
    // dela para uma colega. Assumir (para si) e largar (null) seguem livres.
    if (
      parsed.data.assigneeId !== undefined &&
      parsed.data.assigneeId !== null &&
      parsed.data.assigneeId !== user.id &&
      parsed.data.assigneeId !== conv.assigneeId &&
      !isManagerUp(user)
    ) {
      return NextResponse.json(
        { error: "Só a gerência pode transferir um atendimento para outra pessoa." },
        { status: 403 }
      );
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.status) data.status = parsed.data.status;
    if (parsed.data.priority) data.priority = parsed.data.priority;
    if (parsed.data.markRead) data.unreadCount = 0;
    // marcar à mão nunca APAGA o que já estava: 3 mensagens sem resposta
    // continuam 3; conversa zerada volta com 1
    if (parsed.data.markUnread)
      data.unreadCount = contadorAoMarcarNaoLida(conv.unreadCount);
    if (parsed.data.assigneeId !== undefined) {
      if (parsed.data.assigneeId) {
        // transferência: o destino precisa ser da mesma empresa
        const target = await db.user.findFirst({
          where: { id: parsed.data.assigneeId, companyId: user.companyId },
        });
        if (!target) {
          return NextResponse.json(
            { error: "Usuário inválido" },
            { status: 404 }
          );
        }
      }
      data.assigneeId = parsed.data.assigneeId;
    }
    if (parsed.data.setorId !== undefined) {
      if (parsed.data.setorId) {
        const setor = await db.setor.findFirst({
          where: { id: parsed.data.setorId, companyId: user.companyId },
        });
        if (!setor) return NextResponse.json({ error: "Setor inválido" }, { status: 404 });
      }
      data.setorId = parsed.data.setorId;
    }

    const updated = await db.conversation.update({ where: { id }, data });

    // avisa (sino) quem recebeu o chamado — só quando OUTRA pessoa transferiu
    // e é uma atribuição nova (não notifica reabrir/assumir o próprio).
    if (
      parsed.data.assigneeId &&
      parsed.data.assigneeId !== conv.assigneeId &&
      parsed.data.assigneeId !== user.id
    ) {
      await notifyAssignment({
        companyId: user.companyId,
        convId: id,
        assigneeId: parsed.data.assigneeId,
        actorId: user.id,
        actorName: user.name,
        customerName: conv.customer.name,
      });
    }

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
