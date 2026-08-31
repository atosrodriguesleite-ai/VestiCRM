import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";

/**
 * Editar/arquivar uma conta (RN-027). NÃO existe DELETE de propósito:
 * quando os lançamentos chegarem, apagar conta com histórico quebraria o
 * extrato — arquivar tira das escolhas novas e preserva o passado.
 */

/** A trava pegou: a conta não existe ou é de outra loja. */
class ContaForaDaLoja extends Error {}

const patchSchema = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  tipo: z.enum(["BANCO", "CAIXINHA", "DIGITAL", "POUPANCA"]).optional(),
  saldoInicial: z.number().finite().optional(),
  saldoInicialEm: z.coerce.date().optional(),
  cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  padrao: z.boolean().optional(),
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
    const { arquivar, padrao, ...campos } = parsed.data;

    try {
      const conta = await db.$transaction(async (tx) => {
        // posse conferida ANTES de mexer em qualquer coisa: se a conta não é
        // desta loja (RN-013) ou não existe, um THROW desfaz a transação —
        // um return não desfaria, e o desmarque abaixo ficaria commitado
        const alvo = await tx.finConta.findFirst({
          where: { id, companyId: porta.user.companyId },
          select: { id: true },
        });
        if (!alvo) throw new ContaForaDaLoja();
        if (padrao) {
          await tx.finConta.updateMany({
            where: { companyId: porta.user.companyId, padrao: true, id: { not: id } },
            data: { padrao: false },
          });
        }
        return tx.finConta.update({
          where: { id },
          data: {
            ...campos,
            ...(padrao !== undefined ? { padrao } : {}),
            ...(arquivar !== undefined
              ? { arquivadaEm: arquivar ? new Date() : null, ...(arquivar ? { padrao: false } : {}) }
              : {}),
          },
        });
      });
      return NextResponse.json({ conta });
    } catch (e) {
      if (e instanceof ContaForaDaLoja)
        return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
      // corrida com outra aba marcando padrão: o índice único parcial derruba
      if ((e as { code?: string })?.code === "P2002")
        return NextResponse.json({ error: "Tente de novo" }, { status: 409 });
      throw e;
    }
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
