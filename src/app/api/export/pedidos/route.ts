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
  let s = String(v ?? "").replace(/"/g, '""');
  // neutraliza injeção de fórmula: célula começando com = + - @ é executada
  // pelo Excel/Sheets ao abrir (auditoria 07/08/2026)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s}"` : s;
};
const brlNum = (n: number) => n.toFixed(2).replace(".", ",");
const dataSP = (d: Date | null) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

export async function GET() {
  try {
    const user = await requireUser();
    // EXPORTAÇÃO NÃO ACOMPANHA A VISÃO TOTAL (mesma régua do backup de
    // conversas): ver os pedidos da loja na tela é uma coisa; baixar o
    // faturamento inteiro em CSV é outro tamanho de porta. Vendedora exporta
    // só o que é dela, com ou sem o interruptor.
    const where = orderScope({ ...user, pedidosVisaoTotal: false });
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
      "Pedido", "Criado em", "Pago em", "Cliente", "Telefone", "Vendedor", "Status",
      "Pagamento", "Peças", "Subtotal (R$)", "Desconto (R$)", "Acréscimo (R$)",
      "Frete (R$)", "Valor vendido (R$)", "Total a pagar (R$)",
    ];
    const rows = orders.map((o) => [
      orderNumber(o.number),
      dataSP(o.createdAt),
      dataSP(o.paidAt), // a data que o dinheiro entrou (bate com faturamento)
      o.customer.name,
      o.customer.phone,
      o.seller?.name ?? "",
      orderStatusLabel[o.status] ?? o.status,
      o.payments[0] ? (paymentMethodLabel[o.payments[0].method] ?? "") : "",
      o.items.reduce((s, i) => s + i.quantity, 0),
      brlNum(o.subtotal),
      brlNum(o.discount),
      brlNum(o.surcharge),
      brlNum(o.shippingFee),
      brlNum(o.netTotal), // valor vendido (sem frete) — a régua do faturamento
      // frete-ok: Total a pagar é o que a cliente paga (com frete)
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
