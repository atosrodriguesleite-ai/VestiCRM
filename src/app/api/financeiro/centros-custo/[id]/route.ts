import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/** Renomear/arquivar centro de custo (RN-029; sem DELETE — arquiva). */

const patchSchema = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  arquivar: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { arquivar, nome } = parsed.data;
    const r = await db.finCentroCusto.updateMany({
      where: { id, companyId: porta.user.companyId },
      data: {
        ...(nome !== undefined ? { nome } : {}),
        ...(arquivar !== undefined
          ? { arquivadoEm: arquivar ? new Date() : null }
          : {}),
      },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const centro = await db.finCentroCusto.findUnique({ where: { id } });
    return NextResponse.json({ centro });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
