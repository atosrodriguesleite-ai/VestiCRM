import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { corrigirDataDaVendaSemQuebrar } from "@/lib/financeiro/porta-vendas";
import { isManagerUp, orderScope } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { descricaoDaMudancaDeData, validarDataDaVenda } from "@/lib/data-da-venda";

/**
 * Edita a data da venda (lançamento retroativo) — caso à parte, por botão.
 * Gerente pra cima: reescrever o mês do faturamento é decisão de gestão.
 * Ajusta a criação E o pagamento (quando pago) para o mesmo momento, e
 * registra a mudança na história do pedido.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Editar a data da venda é permitido só para gerente ou admin." },
        { status: 403 }
      );
    }
    const { id } = await params;
    const parsed = z
      .object({ quando: z.string().min(1) })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const quando = new Date(parsed.data.quando);
    const erro = validarDataDaVenda(quando);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });

    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      select: { id: true, status: true, createdAt: true, paidAt: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const pago = (PAID_ORDER_STATUSES as readonly string[]).includes(order.status);
    // a data que manda no faturamento é a do PAGAMENTO — no pedido pago as
    // duas andam juntas; no orçamento só a criação (pagamento ainda não houve)
    const anterior = order.paidAt ?? order.createdAt;
    await db.order.update({
      where: { id: order.id },
      data: { createdAt: quando, ...(pago ? { paidAt: quando } : {}) },
    });
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "NOTA",
        description: descricaoDaMudancaDeData(user.name, anterior, quando),
        userId: user.id,
      },
    });

    // o financeiro acompanha a CORREÇÃO explícita (RN-033): sem isso o DRE e
    // o fluxo seguiam contando a venda no mês errado. O pagamento que chega
    // depois NÃO passa por aqui — competência não muda por pagamento.
    corrigirDataDaVendaSemQuebrar(order.id);

    return NextResponse.json({ ok: true, pago });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
