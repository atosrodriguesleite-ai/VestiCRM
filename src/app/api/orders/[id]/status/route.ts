import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";

/**
 * Status do pedido — consulta LEVE para a tela se atualizar sozinha enquanto
 * a loja espera o pagamento cair (InfinitePay/Mercado Pago confirmam pelo
 * webhook, e a tela aberta não sabia até dar refresh na mão).
 *
 * Escopo igual ao resto de Pedidos: a vendedora só enxerga os pedidos dela;
 * gerência/suporte, a loja toda. Nunca vaza status de outra loja.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      select: { status: true, paidAt: true },
    });
    if (!order)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json({ status: order.status, paidAt: order.paidAt });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
