import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logServerError } from "@/lib/health";
import { confirmarPagamentoInfinitePay } from "@/lib/infinitepay";

/**
 * Webhook da InfinitePay — o aviso de pagamento da loja (token único).
 *
 * O aviso NÃO tem assinatura, então ele NUNCA confirma nada sozinho: é só o
 * gatilho. Quem decide é a conferência na API (payment_check) dentro de
 * `confirmarPagamentoInfinitePay` — sem ela, qualquer um que descobrisse a
 * URL marcaria pedido como pago com um POST.
 *
 * Respostas seguem o contrato da InfinitePay: 200 {"success":true} quando
 * processado; erro NOSSO devolve 500 para ela reenviar (aviso engolido em
 * silêncio foi o incidente do pedido que sumiu — nunca de novo).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const conn = await db.infinitePayConnection.findUnique({
    where: { webhookToken: token },
  });
  // token desconhecido: 200 mudo (nada a reprocessar — evita sonda de tokens)
  if (!conn) return NextResponse.json({ success: true });

  // loja suspensa não ingere (mesma régua das outras portas automáticas)
  const loja = await db.company.findUnique({
    where: { id: conn.companyId },
    select: { suspended: true },
  });
  if (loja?.suspended) return NextResponse.json({ success: true });

  const body = (await req.json().catch(() => null)) as {
    order_nsu?: string;
    transaction_nsu?: string;
    invoice_slug?: string;
    slug?: string;
    amount?: number;
    paid_amount?: number;
    capture_method?: string;
    receipt_url?: string;
  } | null;
  const slug = body?.invoice_slug ?? body?.slug ?? "";
  if (!body?.order_nsu || !body.transaction_nsu || !slug) {
    return NextResponse.json({ success: false, message: "Dados incompletos" }, { status: 400 });
  }

  // valor pago: a InfinitePay manda em `paid_amount`; alguns eventos usam
  // `amount` (o mesmo nome do payload de criação). Aceita os dois — sem
  // valor, a confirmação recusa e a InfinitePay reenvia.
  const valorPago = body.paid_amount ?? body.amount ?? null;

  try {
    const r = await confirmarPagamentoInfinitePay({
      companyId: conn.companyId,
      order_nsu: body.order_nsu,
      transaction_nsu: body.transaction_nsu,
      slug,
      paid_amount: valorPago,
      capture_method: body.capture_method ?? null,
      receipt_url: body.receipt_url ?? null,
    });

    if (r.resultado === "indisponivel") {
      // a conferência falhou (rede/API fora): 500 de propósito — a
      // InfinitePay reenvia e o dinheiro não fica sem confirmação
      return NextResponse.json(
        { success: false, message: "Conferência indisponível — reenvie" },
        { status: 500 }
      );
    }
    // pago, não-pago, não-liquidado (cancelado/valor divergente — já avisado
    // no histórico) ou inválido: processado — não há o que reenviar
    return NextResponse.json({ success: true });
  } catch (e) {
    await logServerError({
      source: "server",
      path: "/api/infinitepay/webhook",
      message: "InfinitePay: webhook falhou — ela vai reenviar",
      detail: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
    }).catch(() => {});
    return NextResponse.json(
      { success: false, message: "Falha ao processar — reenvie" },
      { status: 500 }
    );
  }
}
