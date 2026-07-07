import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { resendMessage } from "@/lib/comm/engine";

/** Reenvia uma mensagem que falhou (nova tentativa via engine). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
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
