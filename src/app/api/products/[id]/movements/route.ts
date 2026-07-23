import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Histórico de estoque de um produto: todos os movimentos das suas variações,
 * do mais recente pro mais antigo. Serve pra responder "quem mexeu no estoque
 * dessa peça e por quê" — ajuste manual, venda, reserva, sincronização da
 * Nuvemshop/Jueri, etc. Somente leitura.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    // garante que o produto é do tenant e pega as variações
    const product = await db.product.findFirst({
      where: { id, companyId: user.companyId },
      select: {
        id: true,
        variants: { select: { id: true, color: true, size: true } },
      },
    });
    if (!product) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }

    const variantIds = product.variants.map((v) => v.id);
    const rotulo = new Map(
      product.variants.map((v) => [v.id, `${v.color} ${v.size}`.trim()])
    );

    const movs = await db.inventoryMovement.findMany({
      where: { companyId: user.companyId, variantId: { in: variantIds } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        variantId: true,
        type: true,
        quantity: true,
        reason: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      movimentos: movs.map((m) => ({
        id: m.id,
        variacao: (m.variantId && rotulo.get(m.variantId)) || "—",
        type: m.type,
        quantity: m.quantity,
        reason: m.reason ?? "",
        createdAt: m.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
