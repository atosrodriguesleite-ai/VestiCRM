import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { whatsapp } from "@/lib/whatsapp";

const schema = z.object({
  body: z.string().min(1),
  kind: z.enum(["TEXT", "NOTE"]).default("TEXT"),
});

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

    const conv = await db.conversation.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true },
    });
    if (!conv) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    // NOTE = nota interna, nunca sai do CRM; TEXT passa pelo provider
    if (parsed.data.kind === "TEXT") {
      const result = await whatsapp.send({
        phone: conv.customer.phone,
        body: parsed.data.body,
      });
      if (!result.ok) {
        return NextResponse.json(
          { error: `Falha no envio: ${result.error}` },
          { status: 502 }
        );
      }
    }

    const message = await db.message.create({
      data: {
        conversationId: conv.id,
        direction: "OUT",
        kind: parsed.data.kind,
        body: parsed.data.body,
        authorId: user.id,
      },
    });

    await db.conversation.update({
      where: { id: conv.id },
      data: { lastMessageAt: new Date(), unreadCount: 0 },
    });
    if (parsed.data.kind === "TEXT") {
      await db.customer.update({
        where: { id: conv.customerId },
        data: { lastContactAt: new Date() },
      });
    }

    return NextResponse.json(message, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
