import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { mpEnv } from "@/lib/mercadopago";

/** Estado da conexão Mercado Pago da loja (para a tela Configurações). */
export async function GET() {
  try {
    const user = await requireUser();
    const conn = await db.mercadoPagoConnection.findUnique({
      where: { companyId: user.companyId },
      select: { mpUserId: true, connectedAt: true, feePercent: true },
    });
    const env = mpEnv();
    return NextResponse.json({
      platformReady: env.configured,
      connected: Boolean(conn),
      connectedAt: conn?.connectedAt ?? null,
      feePercent: conn?.feePercent ?? env.feeDefault,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
