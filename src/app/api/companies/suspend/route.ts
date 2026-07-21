import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/**
 * Suspende / reativa o acesso de uma loja — só o Super Admin. Loja suspensa
 * bloqueia o login dos usuários dela (ex.: inadimplência), mas NÃO apaga nada
 * e é reversível na hora. O Super Admin continua podendo acessar a loja.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = z
      .object({ companyId: z.string().min(1), suspended: z.boolean() })
      .safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await db.company.updateMany({
      where: { id: parsed.data.companyId },
      data: { suspended: parsed.data.suspended },
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, suspended: parsed.data.suspended });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
