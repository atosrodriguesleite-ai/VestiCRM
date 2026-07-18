import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = z
      .object({
        name: z.string().min(1).max(80).optional(),
        contact: z.string().max(120).nullable().optional(),
        pricePerPiece: z.number().nonnegative().max(100000).optional(),
        active: z.boolean().optional(),
      })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await db.sewingFaction.updateMany({
      where: { id, companyId: user.companyId },
      data: parsed.data,
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}
