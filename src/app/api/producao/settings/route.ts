import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

/** Configurações da Produção — tudo cadastrável: mesas, operadores, tipos de
 *  ocorrência e custos extras padrão. Nada fixo no código. */

const schema = z.object({
  tables: z
    .array(z.object({ name: z.string().min(1).max(60), lengthM: z.number().positive().max(100) }))
    .max(30)
    .optional(),
  operators: z.array(z.string().min(1).max(60)).max(60).optional(),
  occurrenceTypes: z.array(z.string().min(1).max(60)).max(40).optional(),
  costItems: z
    .array(z.object({ name: z.string().min(1).max(60), value: z.number().nonnegative().max(100000) }))
    .max(30)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;
    const data: Record<string, string> = {};
    if (d.tables) data.tables = JSON.stringify(d.tables);
    if (d.operators) data.operators = JSON.stringify(d.operators);
    if (d.occurrenceTypes) data.occurrenceTypes = JSON.stringify(d.occurrenceTypes);
    if (d.costItems) data.costItems = JSON.stringify(d.costItems);
    const settings = await db.productionSettings.upsert({
      where: { companyId: user.companyId },
      update: data,
      create: { companyId: user.companyId, ...data },
    });
    return NextResponse.json(settings);
  } catch (e) {
    return producaoErro(e);
  }
}
