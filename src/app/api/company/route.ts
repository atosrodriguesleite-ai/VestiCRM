import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";

const schema = z.object({
  name: z.string().min(1).optional(),
  tagline: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  minOrder: z.number().int().nonnegative().optional(),
});

/** Configurações da loja (admin): nome, frase e WhatsApp do catálogo público. */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const data = { ...parsed.data };
    if (data.whatsapp) data.whatsapp = data.whatsapp.replace(/\D/g, "");

    const updated = await db.company.update({
      where: { id: user.companyId },
      data,
    });
    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      tagline: updated.tagline,
      whatsapp: updated.whatsapp,
      minOrder: updated.minOrder,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
