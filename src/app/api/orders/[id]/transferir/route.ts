import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { podeTransferirVenda, vendaOnline } from "@/lib/orders";

/**
 * Transferir a venda para outra vendedora — em poucos cliques, direto do
 * pedido. É a forma CERTA de mover comissão: com regra e com rastro.
 *
 * Quem pode: a vendedora dona do pedido (ou pedido ainda sem dono) e
 * gerente/admin, que transferem qualquer um. Vendedora nunca mexe no pedido
 * de outra — comissão dos outros não se toca.
 */

const schema = z.object({
  toUserId: z.string().min(1),
  motivo: z.string().max(200).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const order = await db.order.findFirst({
      where: { id, ...orderScope(user) },
      select: { id: true, sellerId: true, number: true, status: true, source: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }

    // mensagem específica antes da genérica: aqui nem a gerência pode (RN-005)
    if (vendaOnline(order)) {
      return NextResponse.json(
        {
          error:
            "Venda da loja online (Nuvemshop) não tem vendedora e não gera comissão — não dá para transferir.",
        },
        { status: 409 }
      );
    }

    if (!podeTransferirVenda(user, order)) {
      return NextResponse.json(
        {
          error:
            "Você só pode transferir pedidos que são seus. Peça para a gerente ou a administradora transferir este.",
        },
        { status: 403 }
      );
    }

    // destino tem que ser da própria loja e estar ativo
    const destino = await db.user.findFirst({
      where: {
        id: parsed.data.toUserId,
        companyId: user.companyId,
        active: true,
        role: { notIn: ["SUPERADMIN", "SUPPORT"] },
      },
      select: { id: true, name: true },
    });
    if (!destino) {
      return NextResponse.json(
        { error: "Escolha uma vendedora ativa da loja." },
        { status: 404 }
      );
    }
    if (destino.id === order.sellerId) {
      return NextResponse.json(
        { error: "Este pedido já é dessa vendedora." },
        { status: 409 }
      );
    }

    const anterior = order.sellerId
      ? await db.user.findUnique({
          where: { id: order.sellerId },
          select: { name: true },
        })
      : null;

    const atualizado = await db.order.update({
      where: { id: order.id },
      data: { sellerId: destino.id },
      select: { id: true, sellerId: true },
    });

    // rastro: transferência de venda é transferência de DINHEIRO
    await db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "STATUS",
        description:
          `Venda transferida de ${anterior?.name ?? "sem vendedor"} para ${destino.name}` +
          ` por ${user.name}` +
          (parsed.data.motivo?.trim() ? ` — ${parsed.data.motivo.trim()}` : ""),
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true, sellerId: atualizado.sellerId, para: destino.name });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
