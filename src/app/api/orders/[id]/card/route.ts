import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderNumber } from "@/lib/orders";
import { mpCreateCardCheckout } from "@/lib/mercadopago";

/**
 * Gera o LINK de pagamento com cartão (parcelado) do pedido — Checkout Pro
 * do Mercado Pago, com a taxa da plataforma embutida. O cliente escolhe as
 * parcelas no link; a confirmação chega sozinha pelo webhook.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: { select: { name: true, email: true } } },
    });
    if (!order)
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.status === "CANCELADO")
      return NextResponse.json(
        { error: "Pedido cancelado não pode ser cobrado." },
        { status: 409 }
      );
    if (order.total <= 0)
      return NextResponse.json(
        { error: "O pedido precisa ter um valor para gerar o link." },
        { status: 409 }
      );

    // link ainda válido? reaproveita
    const existente = await db.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "MERCADO_PAGO",
        status: "PENDENTE",
        checkoutUrl: { not: null },
        dueAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existente?.checkoutUrl) {
      return NextResponse.json({
        paymentId: existente.id,
        url: existente.checkoutUrl,
        amount: existente.amount,
        reused: true,
      });
    }

    const r = await mpCreateCardCheckout({
      companyId: user.companyId,
      externalRef: order.id,
      amount: order.total,
      description: `Pedido ${orderNumber(order.number)} — ${order.customer.name}`,
      payerEmail: order.customer.email,
      payerName: order.customer.name,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

    const payment = await db.payment.create({
      data: {
        orderId: order.id,
        method: "CARTAO",
        status: "PENDENTE",
        amount: order.total,
        provider: "MERCADO_PAGO",
        checkoutUrl: r.url,
        feeAmount: r.feeAmount,
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTA",
        description: `Link de pagamento com cartão gerado por ${user.name} (Mercado Pago) — vale 7 dias`,
        userId: user.id,
      },
    });

    return NextResponse.json({
      paymentId: payment.id,
      url: r.url,
      amount: order.total,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
