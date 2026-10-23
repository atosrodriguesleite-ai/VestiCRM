import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { comPorteira, recusa } from "@/lib/calendario/porta";
import { LIMITES } from "@/lib/calendario/datas";

/** MARCAR / EDITAR / APAGAR TAREFA (RN-092). A tarefa só é achada pela data
 *  DA LOJA (RN-013): o id de tarefa de outra loja responde 404. Marcar como
 *  feita registra quem fez e quando. */
const schema = z.object({
  feita: z.boolean().optional(),
  texto: z.string().trim().min(1).max(LIMITES.tarefa).optional(),
});

async function tarefaDaLoja(id: string, companyId: string) {
  return db.calendarioTarefa.findFirst({
    where: { id, evento: { companyId } },
    select: { id: true },
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return comPorteira(async (user) => {
    const { id } = await ctx.params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return recusa("Dados inválidos.");
    const t = await tarefaDaLoja(id, user.companyId);
    if (!t) return recusa("Tarefa não encontrada.", 404);
    const { feita, texto } = parsed.data;
    if (texto !== undefined) {
      await db.calendarioTarefa.update({ where: { id: t.id }, data: { texto } });
    }
    // marcar só carimba quem ainda NÃO estava feita: a aba velha ou o toque
    // duplo não trocam quem fez nem quando (achado da revisão)
    if (feita === true) {
      await db.calendarioTarefa.updateMany({
        where: { id: t.id, feita: false },
        data: { feita: true, feitaPorNome: user.name, feitaEm: new Date() },
      });
    } else if (feita === false) {
      await db.calendarioTarefa.update({
        where: { id: t.id },
        data: { feita: false, feitaPorNome: null, feitaEm: null },
      });
    }
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return comPorteira(async (user) => {
    const { id } = await ctx.params;
    const t = await tarefaDaLoja(id, user.companyId);
    if (!t) return recusa("Tarefa não encontrada.", 404);
    await db.calendarioTarefa.delete({ where: { id: t.id } });
    return NextResponse.json({ ok: true });
  });
}
