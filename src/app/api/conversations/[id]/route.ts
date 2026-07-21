import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { notifyAssignment } from "@/lib/notify";

const schema = z.object({
  status: z
    .enum(["OPEN", "WAITING_CLIENT", "WAITING_PAYMENT", "CLOSED"])
    .optional(),
  priority: z.enum(["BAIXA", "NORMAL", "ALTA"]).optional(),
  assigneeId: z.string().nullable().optional(),
  setorId: z.string().nullable().optional(), // setor do chamado (transferência)
  markRead: z.boolean().optional(),
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

    const conv = await db.conversation.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: { select: { name: true } } },
    });
    if (!conv) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.status) data.status = parsed.data.status;
    if (parsed.data.priority) data.priority = parsed.data.priority;
    if (parsed.data.markRead) data.unreadCount = 0;
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
