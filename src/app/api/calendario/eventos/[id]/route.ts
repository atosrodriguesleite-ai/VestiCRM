import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataDoDia, diaSP } from "@/lib/dia";
import { comPorteira, recusa } from "@/lib/calendario/porta";
import { LIMITES, foraDaJanela } from "@/lib/calendario/datas";

/**
 * EDITAR / APAGAR UMA DATA (RN-092). Recortado pela loja (RN-013).
 * Na anotação de data do SISTEMA só valem notas e antecedência — o nome e o
 * dia são da regra (Dia das Mães é o 2º domingo de maio para todo mundo).
 * Mudar o dia ou a antecedência APAGA o carimbo do lembrete: a data passa a
 * começar em outro dia, e o aviso tem de poder sair de novo.
 */
const schema = z.object({
  titulo: z.string().trim().min(1).max(LIMITES.titulo).optional(),
  dia: z.string().optional(),
  tipo: z.enum(["COMERCIAL", "OPORTUNIDADE", "LANCAMENTO"]).optional(),
  antecedenciaDias: z.number().int().min(0).max(LIMITES.antecedenciaMax).nullable().optional(),
  notas: z.string().max(LIMITES.notas).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return comPorteira(async (user) => {
    const { id } = await ctx.params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return recusa("Dados inválidos.");
    const ev = await db.calendarioEvento.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, chaveSistema: true, data: true, antecedenciaDias: true },
    });
    if (!ev) return recusa("Data não encontrada.", 404);

    const d = parsed.data;
    const doSistema = ev.chaveSistema !== null;
    if (doSistema && (d.titulo !== undefined || d.dia !== undefined || d.tipo !== undefined)) {
      return recusa("O nome e o dia das datas do sistema não mudam — dá para anotar, criar tarefas e mudar a antecedência.");
    }
    let novaData: Date | undefined;
    if (d.dia !== undefined) {
      const nd = dataDoDia(d.dia);
      if (!nd) return recusa("Essa data não existe no calendário.");
      const fora = foraDaJanela(d.dia, diaSP(new Date()));
      if (fora) return recusa(fora);
      novaData = nd;
    }
    const mudouDia = novaData !== undefined && novaData.getTime() !== ev.data.getTime();
    const mudouAntecedencia =
      d.antecedenciaDias !== undefined && d.antecedenciaDias !== ev.antecedenciaDias;

    await db.calendarioEvento.update({
      where: { id: ev.id },
      data: {
        ...(d.titulo !== undefined ? { titulo: d.titulo } : {}),
        ...(d.tipo !== undefined ? { tipo: d.tipo } : {}),
        ...(novaData ? { data: novaData } : {}),
        ...(d.antecedenciaDias !== undefined ? { antecedenciaDias: d.antecedenciaDias } : {}),
        ...(d.notas !== undefined ? { notas: d.notas.trim() } : {}),
        ...(mudouDia || mudouAntecedencia ? { avisadoEm: null } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return comPorteira(async (user) => {
    const { id } = await ctx.params;
    const ev = await db.calendarioEvento.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, chaveSistema: true },
    });
    if (!ev) return recusa("Data não encontrada.", 404);
    if (ev.chaveSistema) {
      return recusa("Data do sistema não se apaga — use \"Esconder esta data\".");
    }
    await db.calendarioEvento.delete({ where: { id: ev.id } });
    return NextResponse.json({ ok: true });
  });
}
