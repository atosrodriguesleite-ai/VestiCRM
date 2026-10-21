import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

/** Chave do FUNIL EDITÁVEL (RN-091): a gerência da loja passa a criar,
 *  renomear, reordenar e apagar etapas. Sem custo; desligar só esconde o
 *  editor (o funil fica como a loja deixou).
 *  Só o Super Admin liga/desliga, loja por loja, no painel Lojas — nasce
 *  desligada: quem não pediu não vê diferença nenhuma. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = z
      .object({ companyId: z.string().min(1), enabled: z.boolean() })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await db.company.updateMany({
      where: { id: parsed.data.companyId },
      data: { funilEditavelEnabled: parsed.data.enabled },
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
