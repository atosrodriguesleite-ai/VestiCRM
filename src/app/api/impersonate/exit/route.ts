import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, createSession } from "@/lib/auth";

/**
 * Encerra o acesso a uma loja e volta o Super Admin para a própria sessão.
 * Confia no claim assinado `imp` (quem iniciou o acesso) e revalida que ele
 * ainda é um Super Admin ativo.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user?.impersonatedBy) {
    return NextResponse.json(
      { error: "Nenhum acesso de loja em andamento." },
      { status: 400 }
    );
  }

  const superAdmin = await db.user.findFirst({
    where: { id: user.impersonatedBy, role: "SUPERADMIN", active: true },
  });
  if (!superAdmin) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 403 });
  }

  await createSession(superAdmin.id);
  return NextResponse.json({ ok: true });
}
