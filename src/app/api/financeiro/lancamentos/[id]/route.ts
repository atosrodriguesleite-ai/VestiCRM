import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  conferirLancamento,
  lancamentoSchema,
} from "@/lib/financeiro/lancamento-form";
import {
  podeCancelarLancamento,
  podeEditarValores,
} from "@/lib/financeiro/lancamentos";

/**
 * EDITAR ou CANCELAR o lançamento (RN-030). Não existe DELETE: dinheiro que
 * andou não se apaga. Com baixa ativa, nem editar valores nem cancelar —
 * primeiro estorna a baixa (que fica no histórico), depois mexe.
 */

const patchSchema = z.union([
  lancamentoSchema, // ficha inteira (o formulário de edição manda tudo)
  z.object({ cancelar: z.boolean() }),
]);

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

    const atual = await db.finLancamento.findFirst({
      where: { id, companyId: porta.user.companyId },
      include: { parcelas: { include: { baixas: true } } },
    });
    if (!atual)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // ---- cancelar / reabrir ------------------------------------------------
    if ("cancelar" in parsed.data) {
      if (parsed.data.cancelar) {
        const impedimento = podeCancelarLancamento(atual.parcelas);
        if (impedimento)
          return NextResponse.json({ error: impedimento }, { status: 409 });
      }
      await db.finLancamento.update({
        where: { id },
        data: {
          canceladoEm: parsed.data.cancelar ? new Date() : null,
          eventos: {
            create: {
              descricao: parsed.data.cancelar
                ? "Lançamento cancelado"
                : "Lançamento reaberto",
              autorNome: porta.user.name,
            },
          },
        },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- editar a ficha inteira -------------------------------------------
    const impedimento = podeEditarValores(atual.parcelas, atual.origem);
    if (impedimento)
      return NextResponse.json({ error: impedimento }, { status: 409 });

    const conferido = await conferirLancamento(porta.user.companyId, parsed.data);
    if ("erro" in conferido)
      return NextResponse.json({ error: conferido.erro }, { status: 400 });

    // sem baixa ativa (conferido acima), as parcelas podem ser refeitas
    await db.$transaction([
      db.finParcela.deleteMany({ where: { lancamentoId: id } }),
      db.finLancamento.update({
        where: { id },
        data: {
          ...conferido.dados.cabecalho,
          parcelas: {
            create: conferido.dados.parcelas.map((p) => ({
              companyId: porta.user.companyId,
              ...p,
            })),
          },
          eventos: {
            create: {
              descricao: `Lançamento editado — ${conferido.dados.parcelas.length}× no valor de R$ ${conferido.dados.cabecalho.valor.toFixed(2)}`,
              autorNome: porta.user.name,
            },
          },
        },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
