import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationScope } from "@/lib/scope";
import { mapMessage } from "@/lib/inbox-data";

/** Quantas mensagens antigas vêm por vez. */
const LOTE = 100;

/**
 * MENSAGENS ANTERIORES DE UMA CONVERSA.
 *
 * A tela abre com as últimas 100 (é o que qualquer aplicativo de mensagem
 * faz). Sem esta porta, tudo o que veio antes ficava INACESSÍVEL no sistema
 * — a loja tinha a conversa gravada e não conseguia ler. Numa cliente
 * antiga, o começo do relacionamento simplesmente sumia da vista.
 *
 * `antes` = data da mensagem mais velha que a tela já tem.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    // a conversa tem que ser da loja (e visível para quem pediu)
    const conv = await db.conversation.findFirst({
      where: { id, ...conversationScope(user) },
      select: { id: true },
    });
    if (!conv) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const antesRaw = req.nextUrl.searchParams.get("antes");
    const antes = antesRaw ? new Date(antesRaw) : null;
    if (antes && Number.isNaN(antes.getTime())) {
      return NextResponse.json({ error: "Data inválida" }, { status: 400 });
    }

    const linhas = await db.message.findMany({
      where: {
        conversationId: id,
        ...(antes ? { createdAt: { lt: antes } } : {}),
      },
      // da mais nova para a mais velha e depois inverte: é assim que se pega
      // "as 100 anteriores a esta data"
      orderBy: { createdAt: "desc" },
      take: LOTE + 1, // uma a mais só para saber se ainda há passado
      include: {
        author: true,
        replyTo: { select: { id: true, body: true, direction: true } },
      },
    });

    const temMais = linhas.length > LOTE;
    const lote = (temMais ? linhas.slice(0, LOTE) : linhas).reverse();

    return NextResponse.json({
      messages: lote.map(mapMessage),
      temMais,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
