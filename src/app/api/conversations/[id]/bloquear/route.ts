import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationScope, isManagerUp } from "@/lib/scope";
import { evoBlockContact } from "@/lib/comm/evolution";

/**
 * BLOQUEAR / DESBLOQUEAR a cliente no WhatsApp da loja.
 *
 * É o bloqueio de verdade, o mesmo do aplicativo — e por isso:
 *
 *  1. só GERÊNCIA faz. Bloquear é fechar a porta de uma cliente da loja, para
 *     todo mundo, e nem sempre quem está atendendo naquele minuto é quem deve
 *     decidir isso;
 *  2. o sistema só marca "bloqueada" DEPOIS que o WhatsApp aceita. Marcar
 *     antes deixaria a tela dizendo "bloqueada" com as mensagens continuando
 *     a chegar — pior do que não ter o botão;
 *  3. fica registrado na linha do tempo da cliente (quem e quando).
 */

const schema = z.object({ bloquear: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const conv = await db.conversation.findFirst({
      where: { id, ...conversationScope(user) },
      include: { customer: { select: { id: true, name: true, phone: true, blockedAt: true } } },
    });
    if (!conv) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

    if (!isManagerUp(user))
      return NextResponse.json(
        { error: "Bloquear uma cliente é decisão da gerência." },
        { status: 403 }
      );

    // SEM WHATSAPP CONECTADO NÃO EXISTE BLOQUEIO.
    //
    // Marcar aqui e não lá é o pior dos dois mundos: a tela diz "bloqueada" e
    // as mensagens continuam chegando. Melhor recusar e dizer o motivo
    // (achado da revisão — o padrão do CommSettings é MOCK, então isso
    // aconteceria em toda loja recém-criada).
    const s = await db.commSettings.findUnique({ where: { companyId: user.companyId } });
    if (s?.activeProvider !== "EVOLUTION" || !s.evolutionInstance)
      return NextResponse.json(
        {
          error:
            "O WhatsApp da loja não está conectado — o bloqueio precisa acontecer lá, não só aqui.",
        },
        { status: 400 }
      );

    const r = await evoBlockContact(
      s.evolutionInstance,
      conv.customer.phone,
      parsed.data.bloquear ? "block" : "unblock"
    );
    // TEMPO ESGOTADO É "NÃO SEI", não é "não foi". O pedido pode ter chegado:
    // dizer que não foi faria a gerência tentar de novo achando que nada
    // aconteceu. Nada é gravado e a mensagem manda conferir no aplicativo.
    if (!r.ok && r.incerto)
      return NextResponse.json(
        {
          error:
            "O WhatsApp demorou para responder e não deu para confirmar. Confira no aplicativo antes de tentar de novo.",
        },
        { status: 504 }
      );
    if (!r.ok)
      return NextResponse.json(
        {
          error: parsed.data.bloquear
            ? "O WhatsApp não aceitou o bloqueio. A cliente NÃO foi bloqueada."
            : "O WhatsApp não aceitou o desbloqueio. A cliente continua bloqueada.",
        },
        { status: 400 }
      );

    const blockedAt = parsed.data.bloquear ? new Date() : null;
    await db.customer.update({ where: { id: conv.customer.id }, data: { blockedAt } });
    await db.customerEvent.create({
      data: {
        companyId: user.companyId,
        customerId: conv.customer.id,
        type: "OUTRO",
        channel: "WHATSAPP",
        description: parsed.data.bloquear
          ? `${user.name} bloqueou esta cliente no WhatsApp da loja.`
          : `${user.name} desbloqueou esta cliente no WhatsApp da loja.`,
      },
    });

    return NextResponse.json({ blockedAt: blockedAt?.toISOString() ?? null });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Não foi possível concluir." },
      { status: 400 }
    );
  }
}
