import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendMessage } from "@/lib/comm/engine";
import { concluirTarefasDeContato } from "@/lib/contato-feito";
import { conversationScope } from "@/lib/scope";

const schema = z.object({
  body: z.string().min(1),
  kind: z.enum(["TEXT", "NOTE"]).default("TEXT"),
  mediaType: z
    .enum(["TEXT", "IMAGE", "AUDIO", "DOCUMENT", "VIDEO", "TEMPLATE"])
    .default("TEXT"),
  // teto folgado (o corte real do servidor é ~4,5 MB): rejeita cedo um
  // payload absurdo em vez de deixá-lo ocupar a função inteira
  mediaUrl: z.string().max(6_000_000).optional(),
  fileName: z.string().optional(),
  replyToId: z.string().optional(),
});

/**
 * Envio de mensagem — passa SEMPRE pela Communication Engine.
 * A tela não conhece o provedor: Mock hoje, Cloud API amanhã, mesma rota.
 *
 * maxDuration: áudio/vídeo sobem em base64 e o servidor Evolution ainda
 * converte o arquivo — no limite padrão a função era morta NO MEIO do envio
 * (o áudio chegava no cliente, mas a tela mostrava erro).
 */
export const maxDuration = 60;
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

    // ESCOPO: vendedora só envia na conversa dela ou na fila (mesma régua da
    // leitura). Sem isto, uma conversa transferida que "lingava" na tela dela
    // ainda aceitava envio/edição (auditoria 07/08/2026).
    const podeVer = await db.conversation.findFirst({
      where: { id, ...conversationScope(user) },
      select: { id: true },
    });
    if (!podeVer) {
      return NextResponse.json(
        { error: "Esta conversa não está mais com você." },
        { status: 403 }
      );
    }

    // mídia (áudio/foto/vídeo/arquivo) sai em SEGUNDO PLANO: a resposta volta
    // na hora (bolha ⏱️) e o sync confirma o ✓ — segurar a resposta até o fim
    // da conversão era o que mostrava erro com o áudio já entregue
    const ehMidia =
      parsed.data.kind !== "NOTE" &&
      parsed.data.mediaType !== "TEXT" &&
      parsed.data.mediaType !== "TEMPLATE";

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
      background: ehMidia,
    });

    // CONTATO FEITO: mensagem real para a cliente (nota interna não conta)
    // conclui as tarefas de contato dela e tira a sugestão das listas
    if (parsed.data.kind !== "NOTE") {
      const conv = await db.conversation.findUnique({
        where: { id },
        select: { customerId: true },
      });
      if (conv) {
        await concluirTarefasDeContato(user.companyId, conv.customerId).catch(() => 0);
      }
    }

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
