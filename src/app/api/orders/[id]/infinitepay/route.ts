import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { criarLinkInfinitePay } from "@/lib/infinitepay";
import { decryptSecret } from "@/lib/crypto";

/**
 * Gera o link de checkout InfinitePay do pedido (Pix ou cartão em até 12x —
 * a cliente escolhe no checkout). O dinheiro cai direto na conta da loja;
 * a confirmação chega pelo webhook (com conferência na API) e o pedido vira
 * PAGO sozinho.
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
      include: {
        items: {
          select: {
            productId: true,
            name: true,
            color: true,
            size: true,
            quantity: true,
            unitPrice: true,
          },
        },
        customer: { select: { name: true, email: true, phone: true } },
      },
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

    const conn = await db.infinitePayConnection.findUnique({
      where: { companyId: user.companyId },
    });
    if (!conn)
      return NextResponse.json(
        { error: "InfinitePay não conectada. Conecte em Configurações → Pagamentos." },
        { status: 409 }
      );

    // link vigente com o MESMO valor? Reaproveita — não semeia dois links
    // pagáveis do mesmo pedido no WhatsApp da cliente
    const existente = await db.payment.findFirst({
      where: {
        orderId: order.id,
        provider: "INFINITEPAY",
        status: "PENDENTE",
        dueAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    // frete-ok: a cobrança é do total a pagar (com frete)
    if (existente?.checkoutUrl && Math.abs(existente.amount - order.total) < 0.005) {
      return NextResponse.json({ url: existente.checkoutUrl, reused: true });
    }

    const r = await criarLinkInfinitePay({
      conn: {
        handle: conn.handle,
        apiToken: conn.apiToken ? decryptSecret(conn.apiToken) : null,
      },
      webhookToken: conn.webhookToken,
      order,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });

    await db.payment.create({
      data: {
        orderId: order.id,
        // a cliente escolhe Pix OU cartão dentro do checkout — o método real
        // chega com a confirmação (capture_method) e substitui este
        method: "OUTRO",
        status: "PENDENTE",
        // frete-ok: cobrança = o que a cliente paga
        amount: order.total,
        provider: "INFINITEPAY",
        checkoutUrl: r.url,
        // janela de reaproveitamento do MESMO link (o link em si não vence
        // na InfinitePay; vencido aqui, geramos outro)
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTA",
        description: `Link de pagamento InfinitePay gerado por ${user.name} (Pix ou cartão em até 12x)`,
        userId: user.id,
      },
    });

    return NextResponse.json({ url: r.url });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
