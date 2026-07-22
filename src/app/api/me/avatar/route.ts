import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Foto do próprio usuário — cada pessoa pode enviar ou remover a sua, sem
 * depender de um gestor. A imagem chega já redimensionada (data-URL) do
 * navegador. `null` remove a foto e volta às iniciais.
 */
const schema = z.object({
  avatarUrl: z.string().max(700_000).nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    await db.user.update({
      where: { id: user.id },
      data: { avatarUrl: parsed.data.avatarUrl || null },
    });
    return NextResponse.json({ ok: true, avatarUrl: parsed.data.avatarUrl || null });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
