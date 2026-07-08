import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, createSession, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";
import { PLATFORM_SLUG } from "@/lib/platform";

/**
 * Super Admin "acessa uma loja": passa a operar como o administrador daquela
 * loja (acesso total às telas do tenant), mantendo, de forma assinada, o
 * registro de quem é o Super Admin por trás — para poder voltar depois.
 */

const schema = z.object({ companyId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const company = await db.company.findUnique({
      where: { id: parsed.data.companyId },
    });
    if (!company || company.slug === PLATFORM_SLUG) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    // Alvo: o administrador da loja (ou qualquer usuário ativo dela).
    const target =
      (await db.user.findFirst({
        where: { companyId: company.id, role: "ADMIN", active: true },
        orderBy: { createdAt: "asc" },
      })) ??
      (await db.user.findFirst({
        where: { companyId: company.id, active: true },
        orderBy: { createdAt: "asc" },
      }));

    if (!target) {
      return NextResponse.json(
        { error: "Esta loja não possui usuário ativo para acesso." },
        { status: 409 }
      );
    }

    await createSession(target.id, user.id);
    return NextResponse.json({ ok: true, companyName: company.name });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
