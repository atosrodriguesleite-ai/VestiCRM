import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { loadInboxConversations } from "@/lib/inbox-data";

/**
 * Sync incremental da inbox: a tela consulta a cada poucos segundos com
 * `?since=<ISO>` e recebe SÓ as conversas alteradas desde então (mensagem
 * nova, recibo ✓✓, transferência, status...). `now` volta para ancorar a
 * próxima consulta no relógio do servidor (imune a relógio errado no cliente).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sinceRaw = req.nextUrl.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    const conversations = await loadInboxConversations(
      user,
      since && !isNaN(since.getTime()) ? since : undefined
    );
    return NextResponse.json({ now: new Date().toISOString(), conversations });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
