import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { comPorteira, recusa } from "@/lib/calendario/porta";
import { DATA_DO_SISTEMA_POR_CHAVE, LIMITES, segmentosValidos } from "@/lib/calendario/datas";

/**
 * PREFERÊNCIAS DO CALENDÁRIO DA LOJA (RN-092): a antecedência padrão (quantos
 * dias antes de cada data a loja quer começar), os segmentos que trazem as
 * datas de oportunidade e as datas do sistema escondidas. Só gerência.
 */
const schema = z.object({
  antecedenciaDias: z.number().int().min(0).max(LIMITES.antecedenciaMax).optional(),
  segmentos: z.array(z.string().max(40)).max(50).optional(),
  ocultar: z.string().max(60).optional(),
  mostrar: z.string().max(60).optional(),
});

export async function PATCH(req: NextRequest) {
  return comPorteira(async (user) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return recusa("Dados inválidos.");
    const { antecedenciaDias, segmentos, ocultar, mostrar } = parsed.data;
    if (ocultar && !DATA_DO_SISTEMA_POR_CHAVE.has(ocultar)) return recusa("Essa data não existe.");

    // esconder/mostrar é gravação ATÔMICA no banco: ler, montar a lista e
    // gravar deixava duas abas apagarem uma a escolha da outra (revisão)
    if (ocultar) {
      await db.$executeRaw`
        UPDATE "Company"
           SET "calendarioOcultas" = array_append(COALESCE("calendarioOcultas", ARRAY[]::TEXT[]), ${ocultar})
         WHERE "id" = ${user.companyId}
           AND NOT (${ocultar} = ANY(COALESCE("calendarioOcultas", ARRAY[]::TEXT[])))`;
    }
    if (mostrar) {
      await db.$executeRaw`
        UPDATE "Company"
           SET "calendarioOcultas" = array_remove(COALESCE("calendarioOcultas", ARRAY[]::TEXT[]), ${mostrar})
         WHERE "id" = ${user.companyId}`;
    }
    const c = await db.company.update({
      where: { id: user.companyId },
      data: {
        ...(antecedenciaDias !== undefined ? { calendarioAntecedenciaDias: antecedenciaDias } : {}),
        ...(segmentos !== undefined ? { calendarioSegmentos: segmentosValidos(segmentos) } : {}),
      },
      select: { calendarioAntecedenciaDias: true, calendarioSegmentos: true, calendarioOcultas: true },
    });
    return NextResponse.json({
      antecedenciaDias: c.calendarioAntecedenciaDias,
      segmentos: c.calendarioSegmentos,
      ocultas: c.calendarioOcultas,
    });
  });
}
