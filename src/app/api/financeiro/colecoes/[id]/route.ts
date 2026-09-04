import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { dataDoDia } from "@/lib/financeiro/lancamentos";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/** Editar/arquivar coleção (RN-029; sem DELETE — arquiva). */

const patchSchema = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  // DATA É DIA, AO MEIO-DIA EM UTC (RN-030)
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().optional(),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().optional(),
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
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { arquivar, inicio, fim, ...resto } = parsed.data;
    // o dia vira meio-dia UTC (RN-030)
    const campos = {
      ...resto,
      ...(inicio !== undefined ? { inicio: inicio ? dataDoDia(inicio) : null } : {}),
      ...(fim !== undefined ? { fim: fim ? dataDoDia(fim) : null } : {}),
    };
    const r = await db.finColecao.updateMany({
      where: { id, companyId: porta.user.companyId },
      data: {
        ...campos,
        ...(arquivar !== undefined
          ? { arquivadaEm: arquivar ? new Date() : null }
          : {}),
      },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const colecao = await db.finColecao.findUnique({ where: { id } });
    return NextResponse.json({ colecao });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
