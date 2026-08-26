import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { after } from "next/server";
import { sendMessage } from "@/lib/comm/engine";
import { conversationScope } from "@/lib/scope";
import { TETO_DESTINOS } from "@/lib/encaminhar";

/**
 * ENCAMINHAR UMA MENSAGEM para outras conversas (pedido do dono, 26/08/2026)
 * — vale tanto para a que a cliente mandou quanto para a que a loja mandou.
 *
 * POR QUE ISTO É NO SERVIDOR: a tela só conhece o LINK da mídia
 * (`/api/messages/<id>/media`), nunca o arquivo. Encaminhar pelo navegador
 * exigiria baixar a foto/vídeo inteiro e mandar de volta — no celular, com
 * um vídeo, isso é minutos de espera e um payload que o envio recusa. Aqui o
 * arquivo já está do lado do servidor: o conteúdo é copiado direto.
 *
 * Cada destino vira uma mensagem NOVA da loja, pelo caminho normal de envio
 * (mesmo motor, mesma proteção anti-bloqueio, mesmo registro). Nada de
 * "reenviar a mesma mensagem": no WhatsApp, encaminhar é enviar de novo.
 */

export const maxDuration = 60;

const schema = z.object({
  conversationIds: z.array(z.string()).min(1).max(TETO_DESTINOS),
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
      return NextResponse.json({ error: "Escolha ao menos uma conversa." }, { status: 400 });

    // A MENSAGEM DE ORIGEM tem que estar no escopo de quem encaminha
    const origem = await db.message.findFirst({
      where: { id, conversation: { is: conversationScope(user) } },
      select: {
        body: true,
        mediaType: true,
        mediaUrl: true,
        fileName: true,
        kind: true,
        revoked: true,
      },
    });
    if (!origem)
      return NextResponse.json({ error: "Esta conversa não está com você." }, { status: 403 });
    if (origem.kind === "NOTE")
      return NextResponse.json(
        { error: "Nota interna não vai para o WhatsApp — não dá para encaminhar." },
        { status: 400 }
      );
    if (origem.revoked)
      return NextResponse.json(
        { error: "Esta mensagem foi apagada — não dá para encaminhar." },
        { status: 400 }
      );

    // E CADA DESTINO também: sem isto, um id chutado mandaria mensagem para
    // a conversa de outra loja (RN-013)
    const destinos = await db.conversation.findMany({
      where: { id: { in: parsed.data.conversationIds }, ...conversationScope(user) },
      select: { id: true },
    });
    if (destinos.length === 0)
      return NextResponse.json(
        { error: "Nenhuma das conversas escolhidas está com você." },
        { status: 403 }
      );

    // OS ENVIOS SAEM DEPOIS DA RESPOSTA, UM ATRÁS DO OUTRO.
    //
    // Três coisas que só assim funcionam (achados da revisão):
    //  1. o RITMO HUMANO anti-bloqueio (RN-017) só existe se os envios forem
    //     em fila. Deixando cada um "em segundo plano" por conta própria,
    //     eles saem TODOS ao mesmo tempo e o ritmo não acontece — que é
    //     justamente o que faz o WhatsApp desconfiar da conta;
    //  2. esperar por eles dentro do pedido estoura o tempo da função (5
    //     destinos fora da janela de 24h passam de um minuto): a tela dizia
    //     "não foi possível" com metade JÁ entregue, e a vendedora mandava
    //     de novo — a cliente recebia duas vezes;
    //  3. cada bolha conta a própria história no destino (⏱️ → ✓ ou ⚠️ com
    //     "Reenviar"), que é como todo envio já funciona aqui. Por isso a
    //     resposta não promete "entregues": promete "saindo".
    const empresa = user.companyId;
    const autor = { authorId: user.id, authorName: user.name };
    const legenda = origem.mediaType !== "TEXT" ? origem.body.trim() : "";
    after(async () => {
      for (const d of destinos) {
        try {
          await sendMessage({
            conversationId: d.id,
            companyId: empresa,
            body: origem.body,
            kind: "TEXT",
            mediaType: origem.mediaType,
            mediaUrl: origem.mediaUrl ?? undefined,
            fileName: origem.fileName ?? undefined,
            ...autor,
          });
          // A LEGENDA VAI COMO MENSAGEM PRÓPRIA. O envio de mídia manda só o
          // arquivo (o texto que acompanha não viaja): sem isto, a loja via
          // "essa no P, 3 unidades" embaixo da foto e a cliente recebia só a
          // foto — a legenda sumia sem ninguém perceber.
          if (legenda && !legenda.startsWith("[") && !/^[📷🎬🎤📎]/u.test(legenda)) {
            await sendMessage({
              conversationId: d.id,
              companyId: empresa,
              body: legenda,
              kind: "TEXT",
              mediaType: "TEXT",
              ...autor,
            });
          }
        } catch {
          // a própria mensagem fica marcada como FALHOU e a bolha do destino
          // mostra "Reenviar" — não há o que reportar aqui
        }
      }
    });

    return NextResponse.json({
      saindo: destinos.length,
      // destino que o usuário pediu mas não podia ver
      foraDoEscopo: parsed.data.conversationIds.length - destinos.length,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Não foi possível encaminhar." },
      { status: 400 }
    );
  }
}
