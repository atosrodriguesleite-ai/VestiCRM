import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * Renomear/arquivar categoria (RN-029). O que NÃO dá para mudar aqui é
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
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { arquivar, nome } = parsed.data;

    /**
     * ARQUIVAR A MÃE ARQUIVA AS FILHAS.
     *
     * Mexendo só na linha da mãe, as filhas continuavam escolhíveis em todo
     * seletor de categoria e penduradas na árvore numa mãe que sumiu: a
     * lojista arquivava "05 · Administrativas", via 05.01 a 05.09 ainda na
     * lista, arquivava de novo achando que não tinha funcionado, e seguia
     * lançando em "05.03 Salários" sem entender por que o grupo não aparece
     * (auditoria completa do módulo, 03/09/2026). Desarquivar traz de volta
     * a mãe e as filhas juntas, pela mesma régua.
     */
    const r = await db.$transaction(async (tx) => {
      const alvo = await tx.finCategoria.findFirst({
        where: { id, companyId: porta.user.companyId },
        select: { id: true, codigo: true },
      });
      if (!alvo) return 0;
      const dados = {
        ...(nome !== undefined ? { nome } : {}),
        ...(arquivar !== undefined
          ? { arquivadaEm: arquivar ? new Date() : null }
          : {}),
      };
      await tx.finCategoria.update({ where: { id }, data: dados });
      // vale para QUALQUER nível (a subcategoria também tem filhas) e SÓ ao
      // arquivar: DESarquivar a mãe não pode ressuscitar a filha que a
      // lojista arquivou uma a uma (auditoria de 03/09/2026)
      if (arquivar === true) {
        await tx.finCategoria.updateMany({
          where: {
            companyId: porta.user.companyId,
            codigo: { startsWith: `${alvo.codigo}.` },
            arquivadaEm: null,
          },
          data: { arquivadaEm: new Date() },
        });
      }
      return 1;
    });
    if (r === 0)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    const categoria = await db.finCategoria.findUnique({ where: { id } });
    return NextResponse.json({ categoria });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
