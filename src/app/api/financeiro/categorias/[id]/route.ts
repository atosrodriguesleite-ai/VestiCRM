import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * Renomear/arquivar categoria (RN-027). O que NÃO dá para mudar aqui é
 * proposital: tipo e lugar na árvore são estrutura — mudá-los reclassificaria
 * o histórico inteiro em silêncio. Sem DELETE: categoria se arquiva.
 */

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

    const r = await db.finCategoria.updateMany({
      where: { id, companyId: porta.user.companyId },
      data: {
        ...(nome !== undefined ? { nome } : {}),
        ...(arquivar !== undefined
          ? { arquivadaEm: arquivar ? new Date() : null }
          : {}),
      },
    });
    if (r.count === 0)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const categoria = await db.finCategoria.findUnique({ where: { id } });
    return NextResponse.json({ categoria });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
