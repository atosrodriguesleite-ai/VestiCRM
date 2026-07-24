import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { importRecentHistory } from "@/lib/comm/history-import";

export const maxDuration = 60;

/**
 * Importa o histórico recente (últimos 7 dias) do WhatsApp conectado.
 * Só administrador — cria contatos/conversas a partir do histórico.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user))
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    const result = await importRecentHistory(user.companyId, 7);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof Error)
      return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
