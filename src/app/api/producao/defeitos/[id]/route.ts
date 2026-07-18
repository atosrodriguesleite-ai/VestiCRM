import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

/** Peças com defeito: descartar ou voltar a aguardar (conserto vai por lote). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = z
      .object({ status: z.enum(["AGUARDANDO", "DESCARTADA", "RESOLVIDA"]) })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await db.defectItem.updateMany({
      where: { id, companyId: user.companyId },
      data: { status: parsed.data.status },
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}
