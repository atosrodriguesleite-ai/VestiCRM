import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";

/** Desconecta o Melhor Envio da loja (apaga os tokens; nada some no ME). */
export async function POST() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    await db.melhorEnvioConnection.deleteMany({
      where: { companyId: user.companyId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
