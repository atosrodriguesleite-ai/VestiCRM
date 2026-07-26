import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { loadInboxConversations } from "@/lib/inbox-data";
import { runWatchdogIfDue } from "@/lib/health";

/**
 * Sync incremental da inbox: a tela consulta a cada poucos segundos com
 * `?since=<ISO>` e recebe SÓ as conversas alteradas desde então (mensagem
 * nova, recibo ✓✓, transferência, status...). `now` volta para ancorar a
 * próxima consulta no relógio do servidor (imune a relógio errado no cliente).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // vigia do sistema pega carona aqui (rota mais movimentada do app), mas
    // DEPOIS da resposta (after): a checagem externa (até 5s) não segura
    // mais o sync — a inbox responde na hora, sempre
    after(() => runWatchdogIfDue());
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
