import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { emitirNfeDoPedido, consultarNfe } from "@/lib/bling";

/** Emite a NF-e do pedido via Bling (gerente/admin). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const { id } = await params;
    const conn = await db.blingConnection.findUnique({
      where: { companyId: user.companyId },
    });
    if (!conn)
      return NextResponse.json(
        { error: "Conecte o Bling em Configurações para emitir notas." },
        { status: 409 }
      );
    const r = await emitirNfeDoPedido(user.companyId, id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/** Atualiza a situação da NF-e (autorizada? número? link?). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, nfeBlingId: true },
    });
    if (!order?.nfeBlingId)
      return NextResponse.json({ error: "Pedido sem NF-e" }, { status: 404 });
    const c = await consultarNfe(user.companyId, order.nfeBlingId);
    await db.order.update({
      where: { id: order.id },
      data: {
        nfeStatus: c.situacao,
        nfeNumber: c.numero ?? null,
        nfeUrl: c.url ?? null,
      },
    });
    return NextResponse.json(c);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
