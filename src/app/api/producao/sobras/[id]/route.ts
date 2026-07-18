import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

const patchSchema = z.object({
  status: z
    .enum(["DISPONIVEL", "RESERVADA", "CONSUMIDA", "DESCARTADA", "PERDA"])
    .optional(),
  geometry: z.enum(["FAIXA", "RETANGULO", "IRREGULAR", "RETALHOS"]).nullable().optional(),
  quality: z.enum(["BOA", "REGULAR", "RUIM"]).nullable().optional(),
  weightKg: z.number().positive().max(10000).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const sobra = await db.fabricScrap.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!sobra) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    // peso alterado → valor financeiro acompanha proporcionalmente
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.weightKg && sobra.weightKg > 0) {
      const fator = parsed.data.weightKg / sobra.weightKg;
      data.value = Math.round(sobra.value * fator * 100) / 100;
      if (sobra.estimatedM) {
        data.estimatedM = Math.round(sobra.estimatedM * fator * 100) / 100;
      }
    }
    const updated = await db.fabricScrap.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    return producaoErro(e);
  }
}
