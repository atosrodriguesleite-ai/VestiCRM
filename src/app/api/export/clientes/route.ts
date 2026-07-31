import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { ownedScope } from "@/lib/scope";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { customerTypeLabel, originLabel } from "@/lib/format";
import { formatarCpf, formatarCnpj } from "@/lib/documento";

/**
 * Exporta os clientes em CSV (abre direto no Excel/Planilhas).
 * Vendedor exporta só a própria carteira; gerente/admin, a loja toda.
 * Separador ; e BOM UTF-8 — padrão do Excel brasileiro.
 */

const esc = (v: unknown) => {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[";\n]/.test(s) ? `"${s}"` : s;
};

export async function GET() {
  try {
    const user = await requireUser();
    const customers = await db.customer.findMany({
      where: ownedScope(user),
      include: {
        owner: { select: { name: true } },
        // total comprado = pedidos PAGOS (fonte única, inclui integrações),
        // por netTotal (sem frete) — mesma régua das telas de dinheiro
        orders: {
          where: { status: { in: PAID_ORDER_STATUSES } },
          select: { netTotal: true, paidAt: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const header = [
      "Nome", "Telefone", "E-mail", "CPF", "CNPJ", "Tipo", "Origem", "Cidade",
      "Estado", "Endereço", "Bairro", "CEP", "Vendedor", "Total comprado (R$)",
      "Última compra", "Cadastro",
    ];
    const rows = customers.map((c) => [
      c.name,
      c.phone,
      c.email ?? "",
      formatarCpf(c.cpf),
      formatarCnpj(c.cnpj),
      customerTypeLabel[c.type] ?? c.type,
      originLabel[c.origin] ?? c.origin,
      c.city ?? "",
      c.state ?? "",
      [
        [c.street, c.streetNumber].filter(Boolean).join(", "),
        c.complement,
      ].filter(Boolean).join(" - "),
      c.district ?? "",
      c.zip ?? "",
      c.owner?.name ?? "",
      c.orders.reduce((s, v) => s + v.netTotal, 0).toFixed(2).replace(".", ","),
      // última compra vem DOS PEDIDOS PAGOS (o carimbo lastPurchaseAt não é
      // gravado em todos os caminhos e deixava a coluna vazia ou velha)
      (() => {
        const u = c.orders.reduce<Date | null>(
          (max, o) => (o.paidAt && (!max || o.paidAt > max) ? o.paidAt : max),
          null
        );
        return u ? u.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
      })(),
      c.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    ]);

    const csv =
      "﻿" +
      [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
