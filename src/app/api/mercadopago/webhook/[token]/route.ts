import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mpGetPayment } from "@/lib/mercadopago";
import { settleOrderPaid } from "@/lib/settle-order";

/**
 * Webhook do Mercado Pago (aviso de pagamento). O token da URL identifica e
 * autentica a loja. Segurança extra: NUNCA confiamos no corpo do aviso —
 * consultamos o pagamento direto na API do MP (fonte da verdade) usando o
 * token da própria loja antes de dar baixa.
 * Sempre responde 200 (o MP reenvia em caso de erro — sem tempestade).
 */

export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const conn = await db.mercadoPagoConnection.findUnique({
    where: { webhookToken: token },
  });
  if (!conn) return NextResponse.json({ ok: true }); // token desconhecido: ignora

  const body = (await req.json().catch(() => null)) as {
    type?: string;
    action?: string;
    data?: { id?: string | number };
  } | null;
  const mpPaymentId = body?.data?.id ? String(body.data.id) : null;
  const isPayment =
    body?.type === "payment" || body?.action?.startsWith("payment.");
  if (!mpPaymentId || !isPayment) return NextResponse.json({ ok: true });

  try {
    // fonte da verdade: o status REAL consultado na API do MP
    const payment = await mpGetPayment(conn.companyId, mpPaymentId);
    const aprovado = payment?.status === "approved";
    const cartao = payment?.payment_type_id === "credit_card";
    const origem = cartao
      ? `Cartão${payment?.installments && payment.installments > 1 ? ` ${payment.installments}x` : ""} (Mercado Pago)`
      : "Pix (Mercado Pago)";

    // Pix: a linha de cobrança já existe (criada ao gerar o QR).
    // Cartão (link): o pagamento NASCE quando o cliente paga — localiza o
    // pedido pelo external_reference e amarra/cria a linha de cobrança.
    let row = await db.payment.findUnique({ where: { mpPaymentId } });
    if (!row && payment?.external_reference) {
      const order = await db.order.findFirst({
        where: { id: payment.external_reference, companyId: conn.companyId },
        select: { id: true, total: true },
      });
      if (order) {
        const pendente = await db.payment.findFirst({
          where: { orderId: order.id, provider: "MERCADO_PAGO", status: "PENDENTE" },
          orderBy: { createdAt: "desc" },
        });
        row = pendente
          ? await db.payment.update({
              where: { id: pendente.id },
              data: { mpPaymentId, ...(cartao ? { method: "CARTAO" } : {}) },
            })
          : await db.payment.create({
              data: {
                orderId: order.id,
                method: cartao ? "CARTAO" : "PIX",
                status: "PENDENTE",
                amount: payment.transaction_amount ?? order.total,
                provider: "MERCADO_PAGO",
                mpPaymentId,
              },
            });
      }
    } else if (row && cartao && row.method !== "CARTAO") {
      await db.payment.update({ where: { id: row.id }, data: { method: "CARTAO" } });
    }

    let liquidado = false;
    if (aprovado && row) {
      const r = await settleOrderPaid(row.orderId, origem);
      liquidado = r.ok;
    }

    // diagnóstico na Central de Comunicação (visível para a loja)
    await db.commEvent
      .create({
        data: {
          companyId: conn.companyId,
          channel: "WHATSAPP", // canal genérico do monitor
          direction: "IN",
          type: "mp.pagamento",
          status: aprovado ? "OK" : "ERRO",
          payload: JSON.stringify({
            mpPaymentId,
            statusMp: payment?.status ?? "desconhecido",
            pedido: row?.orderId ?? "não encontrado",
            liquidado,
          }).slice(0, 500),
        },
      })
      .catch(() => {});
  } catch {
    // erros aqui não podem derrubar o webhook
  }
  return NextResponse.json({ ok: true });
}
