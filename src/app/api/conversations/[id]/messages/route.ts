import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { sendMessage } from "@/lib/comm/engine";

const schema = z.object({
  body: z.string().min(1),
  kind: z.enum(["TEXT", "NOTE"]).default("TEXT"),
  mediaType: z
    .enum(["TEXT", "IMAGE", "AUDIO", "DOCUMENT", "VIDEO", "TEMPLATE"])
    .default("TEXT"),
  mediaUrl: z.string().optional(),
  fileName: z.string().optional(),
  replyToId: z.string().optional(),
});

/**
 * Envio de mensagem — passa SEMPRE pela Communication Engine.
 * A tela não conhece o provedor: Mock hoje, Cloud API amanhã, mesma rota.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const message = await sendMessage({
      conversationId: id,
      companyId: user.companyId,
      body: parsed.data.body,
      kind: parsed.data.kind,
      mediaType: parsed.data.mediaType,
      mediaUrl: parsed.data.mediaUrl,
      fileName: parsed.data.fileName,
      replyToId: parsed.data.replyToId,
      authorId: user.id,
      authorName: user.name,
    });

    // mídia volta como LINK (não base64) — mesmo formato do sync da inbox
    return NextResponse.json(
      {
        ...message,
        mediaUrl:
          message.mediaUrl && message.mediaUrl.startsWith("data:")
            ? `/api/messages/${message.id}/media`
            : message.mediaUrl,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (e instanceof Error && e.message === "Conversa não encontrada")
      return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
