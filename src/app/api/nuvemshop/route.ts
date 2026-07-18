import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { nuvemshopEnv } from "@/lib/nuvemshop";

/** Estado da conexão Nuvemshop (para o card em Configurações). */
export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const conn = await db.nuvemshopConnection.findUnique({
      where: { companyId: user.companyId },
    });
    const produtos = conn
      ? await db.product.count({
          where: { companyId: user.companyId, nuvemshopId: { not: null } },
        })
      : 0;
    const vendas = conn
      ? await db.order.count({
          where: { companyId: user.companyId, source: "NUVEMSHOP" },
        })
      : 0;
    return NextResponse.json({
      serverConfigured: nuvemshopEnv().configured,
      connected: Boolean(conn && conn.status === "CONECTADO"),
      storeId: conn?.storeId ?? null,
      lastProductSync: conn?.lastProductSync ?? null,
      lastCheckoutSync: conn?.lastCheckoutSync ?? null,
      produtos,
      vendas,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/** Desconecta a loja online (dados espelhados ficam; nada é apagado). */
export async function DELETE() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    await db.nuvemshopConnection.updateMany({
      where: { companyId: user.companyId },
      data: { status: "DESCONECTADO" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
