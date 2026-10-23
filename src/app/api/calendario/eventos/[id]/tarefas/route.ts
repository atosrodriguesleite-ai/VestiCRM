import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { comPorteira, recusa } from "@/lib/calendario/porta";
import { LIMITES } from "@/lib/calendario/datas";

/** NOVA TAREFA numa data do calendário (RN-092): "o que precisa acontecer
 *  para a data dar certo". A data tem que ser da loja (RN-013). */
const schema = z.object({ texto: z.string().trim().min(1).max(LIMITES.tarefa) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return comPorteira(async (user) => {
    const { id } = await ctx.params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return recusa("Escreva a tarefa (até 200 letras).");
    const ev = await db.calendarioEvento.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, _count: { select: { tarefas: true } } },
    });
    if (!ev) return recusa("Data não encontrada.", 404);
    if (ev._count.tarefas >= LIMITES.tarefasPorData) {
      return recusa(`Esta data já tem ${LIMITES.tarefasPorData} tarefas — apague as que não servem mais.`);
    }
    const t = await db.calendarioTarefa.create({
      data: { eventoId: ev.id, texto: parsed.data.texto, ordem: ev._count.tarefas },
      select: { id: true },
    });
    return NextResponse.json({ id: t.id }, { status: 201 });
  });
}
