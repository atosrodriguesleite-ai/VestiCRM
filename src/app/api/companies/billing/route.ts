import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { clampDueDay } from "@/lib/billing";

/**
 * Configuração de cobrança de uma loja — só o Super Admin.
 * Cria/atualiza os valores (implementação, recorrência, vencimento), a
 * etiqueta (TESTE | PAGANTE | CORTESIA) e a observação do acordo.
 */

const schema = z.object({
  companyId: z.string().min(1),
  kind: z.enum(["TESTE", "PAGANTE", "CORTESIA"]).optional(),
  implementationFee: z.number().min(0).max(1_000_000).optional(),
  monthlyFee: z.number().min(0).max(1_000_000).optional(),
  dueDay: z.number().int().optional(),
  notes: z.string().max(2000).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { companyId, dueDay, notes, ...rest } = parsed.data;

    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    const data = {
      ...rest,
      ...(dueDay != null ? { dueDay: clampDueDay(dueDay) } : {}),
      ...(notes != null ? { notes: notes.trim() || null } : {}),
    };

    const billing = await db.companyBilling.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });

    return NextResponse.json({ ok: true, billing });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
