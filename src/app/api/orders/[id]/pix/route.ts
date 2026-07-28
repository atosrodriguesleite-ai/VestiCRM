import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { orderNumber } from "@/lib/orders";
import { mpCreatePixCharge } from "@/lib/mercadopago";

/**
 * Gera a cobrança Pix do pedido (Mercado Pago, com a taxa da plataforma
 * embutida). Devolve QR Code + copia-e-cola; a confirmação chega sozinha
 * pelo webhook e o pedido vira PAGO automaticamente.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
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
        { error: "O pedido precisa ter um valor para gerar a cobrança." },
        { status: 409 }
      );

    // cobrança ainda válida? reaproveita (não duplica Pix pro cliente)
    const existente = await db.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "MERCADO_PAGO",
        status: "PENDENTE",
        dueAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existente?.pixCopiaECola) {
      return NextResponse.json({
        paymentId: existente.id,
        copiaECola: existente.pixCopiaECola,
        qrBase64: existente.pixQrBase64,
        amount: existente.amount,
        reused: true,
      });
    }

    const r = await mpCreatePixCharge({
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
        method: "PIX",
        status: "PENDENTE",
        amount: order.total,
        provider: "MERCADO_PAGO",
        mpPaymentId: r.charge.mpPaymentId,
        pixCopiaECola: r.charge.copiaECola,
        pixQrBase64: r.charge.qrBase64,
        feeAmount: r.charge.feeAmount,
        dueAt: r.charge.expiresAt,
      },
    });
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTA",
        description: `Cobrança Pix gerada por ${user.name} (Mercado Pago) — vale 24h`,
        userId: user.id,
      },
    });

    return NextResponse.json({
      paymentId: payment.id,
      copiaECola: payment.pixCopiaECola,
      qrBase64: payment.pixQrBase64,
      amount: payment.amount,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
