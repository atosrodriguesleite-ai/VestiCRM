import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { canSeeAll, orderScope } from "@/lib/scope";
import { orderStatusLabel, orderNumber, paymentMethodLabel } from "@/lib/orders";

/**
 * Exporta os pedidos em CSV (abre direto no Excel/Planilhas).
 * Vendedor exporta os próprios pedidos; gerente/admin, a loja toda.
 */

const esc = (v: unknown) => {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[";\n]/.test(s) ? `"${s}"` : s;
};
const brlNum = (n: number) => n.toFixed(2).replace(".", ",");

export async function GET() {
  try {
    const user = await requireUser();
    // mesma régua da tela de Pedidos: vendedora exporta só o que é dela
    const where = orderScope(user);
    const orders = await db.order.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        seller: { select: { name: true } },
        payments: { orderBy: { createdAt: "asc" }, take: 1 },
        items: { select: { quantity: true } },
      },
      orderBy: { number: "desc" },
    });

    const header = [
      "Pedido", "Data", "Cliente", "Telefone", "Vendedor", "Status",
      "Pagamento", "Peças", "Subtotal (R$)", "Desconto (R$)", "Frete (R$)",
      "Total (R$)",
    ];
    const rows = orders.map((o) => [
      orderNumber(o.number),
      o.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      o.customer.name,
      o.customer.phone,
      o.seller?.name ?? "",
      orderStatusLabel[o.status] ?? o.status,
      o.payments[0] ? (paymentMethodLabel[o.payments[0].method] ?? "") : "",
      o.items.reduce((s, i) => s + i.quantity, 0),
      brlNum(o.subtotal),
      brlNum(o.discount),
      brlNum(o.shippingFee),
      brlNum(o.total),
    ]);

    const csv =
      "﻿" +
      [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pedidos-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
