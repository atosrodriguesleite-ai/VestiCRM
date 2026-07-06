import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { computeAutomations } from "@/lib/automations";

const schema = z.object({ key: z.string().min(1) });

/** Transforma uma sugestão de automação em tarefa real (idempotente). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const suggestions = await computeAutomations(user);
    const suggestion = suggestions.find((s) => s.key === parsed.data.key);
    if (!suggestion) {
      return NextResponse.json(
        { error: "Sugestão não encontrada ou já aplicada" },
        { status: 404 }
      );
    }

    const task = await db.task.create({
      data: {
        companyId: user.companyId,
        customerId: suggestion.customerId,
        opportunityId: suggestion.opportunityId,
        title: suggestion.title,
        type: suggestion.taskType,
        priority: suggestion.priority,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        assigneeId: user.id,
        autoRule: suggestion.key,
      },
    });
    return NextResponse.json(task, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
