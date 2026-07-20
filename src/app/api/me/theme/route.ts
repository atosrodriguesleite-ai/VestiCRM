import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Preferência de tema (claro/escuro) — escolha INDIVIDUAL: cada usuário
 * salva a sua no próprio perfil, sem afetar os colegas.
 */
const schema = z.object({ dark: z.boolean() });

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    await db.user.update({
      where: { id: user.id },
      data: { prefersDark: parsed.data.dark },
    });
    return NextResponse.json({ ok: true, dark: parsed.data.dark });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
