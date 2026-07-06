import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({
  status: z.enum(["PENDENTE", "CONCLUIDA", "CANCELADA"]).optional(),
  dueAt: z.string().optional(),
  priority: z.enum(["BAIXA", "MEDIA", "ALTA"]).optional(),
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

    const task = await db.task.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!task) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.status) data.status = parsed.data.status;
    if (parsed.data.priority) data.priority = parsed.data.priority;
    if (parsed.data.dueAt) data.dueAt = new Date(parsed.data.dueAt);

    // concluir tarefa de contato atualiza o "último contato" do cliente
    if (parsed.data.status === "CONCLUIDA" && task.customerId) {
      await db.customer.update({
        where: { id: task.customerId },
        data: { lastContactAt: new Date() },
      });
    }

    const updated = await db.task.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
