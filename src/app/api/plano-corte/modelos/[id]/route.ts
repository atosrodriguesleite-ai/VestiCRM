import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";

/** Detalhe completo do modelo (peças com medidas) e exclusão. */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const m = await db.cutPlanModel.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    return NextResponse.json({
      id: m.id,
      name: m.name,
      source: m.source,
      thumbnail: m.thumbnail,
      sizes: JSON.parse(m.sizes),
      pieces: JSON.parse(m.pieces),
      createdAt: m.createdAt.toISOString(),
    });
  } catch (e) {
    return planoCorteErro(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const m = await db.cutPlanModel.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    await db.cutPlanModel.delete({ where: { id: m.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return planoCorteErro(e);
  }
}
