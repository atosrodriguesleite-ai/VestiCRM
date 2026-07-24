import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { revokeMessage, editMessageText } from "@/lib/comm/engine";

const editSchema = z.object({ body: z.string().min(1).max(4000) });

/** Editar o texto de uma mensagem enviada (WhatsApp: até ~15min). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = editSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Texto inválido" }, { status: 400 });
    const message = await editMessageText(user.companyId, id, parsed.data.body.trim());
    return NextResponse.json(message);
  } catch (e) {
    return handle(e);
  }
}

/** Apagar a mensagem "para todos" (some do WhatsApp do cliente). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const message = await revokeMessage(user.companyId, id);
    return NextResponse.json(message);
  } catch (e) {
    return handle(e);
  }
}

function handle(e: unknown) {
  if (e instanceof AuthError)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (e instanceof Error && e.message === "Mensagem não encontrada")
    return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof Error)
    return NextResponse.json({ error: e.message }, { status: 400 });
  throw e;
}
