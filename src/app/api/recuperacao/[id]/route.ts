import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { PAID_ORDER_STATUSES } from "@/lib/orders";

const schema = z.object({
  // CHAMADA = a vendedora mandou mensagem; RECUPERADO/PERDIDO fecham;
  // NOVO devolve para a fila (desfazer um engano)
  status: z.enum(["NOVO", "CHAMADA", "RECUPERADO", "PERDIDO"]),
});

/** Move um carrinho na esteira (sempre da própria loja). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const cart = await db.abandonedCart.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true, customerId: true, abandonedAt: true },
    });
    if (!cart) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    const s = parsed.data.status;
    const agora = new Date();
    // RECUPERADO à mão também amarra o pedido pago pós-abandono (se houver):
    // sem o vínculo, a varredura automática podia amarrar o MESMO pedido em
    // outro carrinho e o placar contava a venda em dobro (auditoria
    // 07/08/2026). Pedido já usado por outro carrinho fica de fora.
    let recoveredOrderId: string | null = null;
    if (s === "RECUPERADO" && cart.customerId) {
      const usados = await db.abandonedCart.findMany({
        where: { companyId: user.companyId, recoveredOrderId: { not: null } },
        select: { recoveredOrderId: true },
      });
      const pedido = await db.order.findFirst({
        where: {
          companyId: user.companyId,
          customerId: cart.customerId,
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gt: cart.abandonedAt },
          id: { notIn: usados.map((u) => u.recoveredOrderId as string) },
        },
        orderBy: { paidAt: "asc" },
        select: { id: true },
      });
      recoveredOrderId = pedido?.id ?? null;
    }
    await db.abandonedCart.update({
      where: { id },
      data: {
        status: s,
        ...(s === "CHAMADA" ? { contactedAt: agora } : {}),
        ...(s === "RECUPERADO" ? { recoveredAt: agora, recoveredOrderId } : {}),
        ...(s === "PERDIDO" ? { lostAt: agora } : {}),
        ...(s === "NOVO"
          ? { contactedAt: null, recoveredAt: null, lostAt: null, recoveredOrderId: null }
          : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
