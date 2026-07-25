import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { blingEnv } from "@/lib/bling";

/** Estado da conexão Bling da loja (para a tela Configurações). */
export async function GET() {
  try {
    const user = await requireUser();
    const conn = await db.blingConnection.findUnique({
      where: { companyId: user.companyId },
      select: { connectedAt: true },
    });
    return NextResponse.json({
      platformReady: blingEnv().configured,
      connected: Boolean(conn),
      connectedAt: conn?.connectedAt ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
