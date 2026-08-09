import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { resendMessage } from "@/lib/comm/engine";
import { db } from "@/lib/db";
import { conversationScope } from "@/lib/scope";

// reenvio de mídia também pode passar do limite padrão (base64 + conversão)
export const maxDuration = 60;

/** Reenvia uma mensagem que falhou (nova tentativa via engine). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    // só reenvia mensagem de conversa que é sua (ou da fila) — auditoria 07/08
    const noEscopo = await db.message.findFirst({
      where: { id, conversation: { is: conversationScope(user) } },
      select: { id: true },
    });
    if (!noEscopo)
      return NextResponse.json({ error: "Esta conversa não está com você." }, { status: 403 });
    const message = await resendMessage(user.companyId, id);
    return NextResponse.json(message);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof Error && e.message === "Mensagem não encontrada")
      return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
