import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Mensagem do botão "enviar link do catálogo" na inbox. É operacional (não é
 * credencial), então QUALQUER membro da equipe da loja pode ajustar — sem
 * passar pela porta das credenciais (essa continua só do admin).
 */

const schema = z.object({
  catalogLinkMsg: z.string().max(500).nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const value = parsed.data.catalogLinkMsg?.trim() || null;
    await db.commSettings.upsert({
      where: { companyId: user.companyId },
      update: { catalogLinkMsg: value },
      create: { companyId: user.companyId, catalogLinkMsg: value },
    });
    return NextResponse.json({ ok: true, catalogLinkMsg: value });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
