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

    // Cobrança PIX ainda válida? Reaproveita (não duplica Pix pro cliente).
    // O filtro por método importa: um link de cartão mais novo escondia o
    // Pix vigente, e o refazer estourava a unicidade do mpPaymentId (P2002).
    const existente = await db.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "MERCADO_PAGO",
        method: "PIX",
        status: "PENDENTE",
        dueAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    // ... e SÓ se o valor ainda bate com o pedido. A edição do pedido já
    // invalida cobranças pendentes, mas esta porta se defende sozinha: um
    // caminho futuro que mude o total sem invalidar não devolve QR errado.
    if (existente?.pixCopiaECola && Math.abs(existente.amount - order.total) < 0.005) {
      return NextResponse.json({
        paymentId: existente.id,
        copiaECola: existente.pixCopiaECola,
        qrBase64: existente.pixQrBase64,
        amount: existente.amount,
        reused: true,
      });
    }

    // nº da tentativa: entra na chave de idempotência do MP (ver o porquê
    // em mpCreatePixCharge — pedido editado 100→120→100 repetia a chave)
    const tentativa = await db.payment.count({
      where: { orderId: order.id, provider: "MERCADO_PAGO" },
    });
    const r = await mpCreatePixCharge({
      companyId: user.companyId,
      externalRef: order.id,
      amount: order.total,
      description: `Pedido ${orderNumber(order.number)} — ${order.customer.name}`,
      payerEmail: order.customer.email,
      payerName: order.customer.name,
      tentativa,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

    // Dois cliques ao MESMO tempo: ambos passam do "reaproveita", o MP
    // devolve o mesmo pagamento (idempotência) e o segundo create cai na
    // unicidade do mpPaymentId. Não é erro — é a mesma cobrança: devolve ela.
    let payment;
    try {
      payment = await db.payment.create({
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
    } catch (err) {
      const gemea = await db.payment.findUnique({
        where: { mpPaymentId: r.charge.mpPaymentId },
      });
      if (!gemea) throw err;
      return NextResponse.json({
        paymentId: gemea.id,
        copiaECola: gemea.pixCopiaECola,
        qrBase64: gemea.pixQrBase64,
        amount: gemea.amount,
        reused: true,
      });
    }
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
