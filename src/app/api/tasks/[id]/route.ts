import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { TIPOS_DE_CONTATO } from "@/lib/contato-feito";
import { taskScope } from "@/lib/scope";

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

    // taskScope: vendedora só mexe na própria tarefa (a agenda dela já filtra
    // assim; a API aceitava qualquer id — auditoria 07/08/2026).
    const task = await db.task.findFirst({
      where: { id, ...taskScope(user) },
    });
    if (!task) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.status) {
      data.status = parsed.data.status;
      // status mudado POR GENTE apaga o motivo automático. Sem isso, uma
      // tarefa reaberta e concluída à mão continuava dizendo "Concluída pelo
      // sistema — o pagamento entrou", que vira mentira na tela.
      data.autoDoneReason = null;
    }
    if (parsed.data.priority) data.priority = parsed.data.priority;
    if (parsed.data.dueAt) data.dueAt = new Date(parsed.data.dueAt);

    // Concluir tarefa DE CONTATO atualiza o "último contato" da cliente.
    // Só as de contato: concluir uma cobrança ou um "separar a troca" não
    // significa que alguém falou com a cliente — carimbar ali silenciaria
    // campanhas e automações que dependem de `lastContactAt`.
    if (
      parsed.data.status === "CONCLUIDA" &&
      task.customerId &&
      TIPOS_DE_CONTATO.includes(task.type)
    ) {
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
