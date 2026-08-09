import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { revokeMessage, editMessageText } from "@/lib/comm/engine";
import { db } from "@/lib/db";
import { conversationScope } from "@/lib/scope";
import type { SessionUser } from "@/lib/auth";

const editSchema = z.object({ body: z.string().min(1).max(4000) });

/**
 * A mensagem está numa conversa que este usuário pode mexer? (a dela ou a
 * fila). A tela já filtra assim na leitura; editar/apagar aceitava qualquer
 * id (auditoria 07/08/2026). Devolve a mensagem se no escopo, senão null.
 */
async function mensagemNoEscopo(user: SessionUser, messageId: string) {
  return db.message.findFirst({
    where: { id: messageId, conversation: { is: conversationScope(user) } },
    select: { id: true },
  });
}

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
    if (!(await mensagemNoEscopo(user, id)))
      return NextResponse.json({ error: "Esta conversa não está com você." }, { status: 403 });
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
    if (!(await mensagemNoEscopo(user, id)))
      return NextResponse.json({ error: "Esta conversa não está com você." }, { status: 403 });
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
