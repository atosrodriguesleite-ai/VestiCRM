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

    // A tarefa vence HOJE (fim do dia em São Paulo): quem aplica a sugestão
    // quer agir agora — assim ela aparece na aba "Hoje", não em "Próximas".
    const SP_OFFSET = 3 * 60 * 60 * 1000; // São Paulo é UTC-3
    const spNow = new Date(Date.now() - SP_OFFSET);
    spNow.setUTCHours(23, 59, 0, 0);
    const endOfDaySP = new Date(spNow.getTime() + SP_OFFSET);

    const task = await db.task.create({
      data: {
        companyId: user.companyId,
        customerId: suggestion.customerId,
        opportunityId: suggestion.opportunityId,
        title: suggestion.title,
        type: suggestion.taskType,
        priority: suggestion.priority,
        dueAt: endOfDaySP,
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
