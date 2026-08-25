import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { reagirNaMensagem } from "@/lib/comm/engine";
import { db } from "@/lib/db";
import { conversationScope } from "@/lib/scope";

/**
 * REAGIR A UMA MENSAGEM COM EMOJI (igual ao aplicativo do WhatsApp).
 *
 * Emoji vazio REMOVE a reação — é assim que o WhatsApp desfaz.
 *
 * Rota à parte do PATCH (que edita o texto) de propósito: são gestos
 * diferentes, com permissões e erros diferentes, e misturar os dois num
 * schema só deixaria a rota de editar mais frágil do que ela precisa ser.
 */

const schema = z.object({
  // um emoji tem vários "caracteres" (pele, junção); o teto é generoso de
  // propósito, e vazio significa "tirar a reação"
  emoji: z.string().max(16),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Emoji inválido" }, { status: 400 });

    // MESMO ESCOPO DA LEITURA (RN-013 + conversationScope): vendedora só
    // reage em conversa dela ou da fila. A tela já filtra, mas quem manda
    // aqui é o servidor.
    const noEscopo = await db.message.findFirst({
      where: { id, conversation: { is: conversationScope(user) } },
      select: { id: true },
    });
    if (!noEscopo)
      return NextResponse.json(
        { error: "Esta conversa não está com você." },
        { status: 403 }
      );

    const message = await reagirNaMensagem(
      user.companyId,
      id,
      parsed.data.emoji.trim()
    );
    return NextResponse.json({ id: message.id, reactionStore: message.reactionStore });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Não foi possível reagir." },
      { status: 400 }
    );
  }
}
