import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Mensagens automáticas da inbox (link do catálogo e confirmação de pedido).
 * São operacionais (não são credenciais), então QUALQUER membro da equipe da
 * loja pode ajustar — sem passar pela porta das credenciais (só do admin).
 */

const schema = z.object({
  catalogLinkMsg: z.string().max(500).nullable().optional(),
  orderMsg: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const data: Record<string, string | null> = {};
    if (parsed.data.catalogLinkMsg !== undefined)
      data.catalogLinkMsg = parsed.data.catalogLinkMsg?.trim() || null;
    if (parsed.data.orderMsg !== undefined)
      data.orderMsg = parsed.data.orderMsg?.trim() || null;
    await db.commSettings.upsert({
      where: { companyId: user.companyId },
      update: data,
      create: { companyId: user.companyId, ...data },
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
