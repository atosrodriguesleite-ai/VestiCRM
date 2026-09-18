import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderScope } from "@/lib/scope";
import { porteiraEtiquetas } from "@/lib/etiquetas/gate";
import { orderNumber } from "@/lib/orders";

/**
 * PEDIDO PELO NÚMERO, para a aba Imprimir: devolve as peças dele (com a
 * quantidade de cada linha) e o id, para a etiqueta de envio. Respeita a
 * visibilidade de pedidos (RN-007): vendedora só acha os dela.
 */
export async function GET(req: NextRequest) {
  try {
    const porta = await porteiraEtiquetas();
    if (!porta.ok) return porta.resposta;
    const numero = Number((req.nextUrl.searchParams.get("numero") ?? "").replace(/\D/g, ""));
    if (!Number.isInteger(numero) || numero <= 0) return NextResponse.json({ error: "Digite o número do pedido." }, { status: 400 });
    const pedido = await db.order.findFirst({
      where: { ...orderScope(porta.user), number: numero },
      select: {
        id: true,
        number: true,
        status: true,
        customer: { select: { name: true } },
        items: { select: { variantId: true, name: true, color: true, size: true, quantity: true } },
      },
    });
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
    return NextResponse.json({
      id: pedido.id,
      numero: orderNumber(pedido.number),
      status: pedido.status,
      cliente: pedido.customer.name,
      itens: pedido.items
        .filter((i) => i.variantId)
        .map((i) => ({
          variantId: i.variantId!,
          rotulo: i.name,
          detalhe: [i.color, i.size].filter(Boolean).join(" · ") || undefined,
          quantidade: i.quantity,
        })),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
