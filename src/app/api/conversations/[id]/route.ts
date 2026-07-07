import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  status: z
    .enum(["OPEN", "WAITING_CLIENT", "WAITING_PAYMENT", "CLOSED"])
    .optional(),
  priority: z.enum(["BAIXA", "NORMAL", "ALTA"]).optional(),
  assigneeId: z.string().nullable().optional(),
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

    const updated = await db.conversation.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
