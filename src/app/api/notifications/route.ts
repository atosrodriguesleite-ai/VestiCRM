import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/** Minhas notificações (sino) — recentes + contagem de não lidas. */
export async function GET() {
  try {
    const user = await requireUser();
    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      db.notification.count({ where: { userId: user.id, read: false } }),
    ]);
    return NextResponse.json({
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        convId: n.convId,
        orderId: n.orderId,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const patchSchema = z.object({
  id: z.string().optional(),
  all: z.boolean().optional(),
});

/** Marca como lida uma notificação (id) ou todas (all). */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    if (parsed.data.all) {
      await db.notification.updateMany({
        where: { userId: user.id, read: false },
        data: { read: true },
      });
    } else if (parsed.data.id) {
      await db.notification.updateMany({
        where: { id: parsed.data.id, userId: user.id },
        data: { read: true },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
