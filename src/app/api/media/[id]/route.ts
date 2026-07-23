import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/** Remove uma imagem da biblioteca (só do tenant). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const r = await db.mediaAsset.deleteMany({
      where: { id, companyId: user.companyId },
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Imagem não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
