import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";

/** Remove um meio de envio (admin/gerente ou Suporte). Pedidos antigos que já
 *  usam o nome continuam com o texto salvo — não perdem a informação. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!(isManagerUp(user) || isSupport(user))) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const method = await db.shippingMethod.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!method) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    await db.shippingMethod.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
