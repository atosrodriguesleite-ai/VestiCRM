import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
    const corpo = parsed.data;
    if ("cancelar" in corpo) {
      /**
       * A CONFERÊNCIA MORA DENTRO DA TRANSAÇÃO, e SERIALIZÁVEL.
       *
       * Lida de fora, uma baixa que chegasse no meio (a colega clicando
       * "Recebi" na outra aba, ou a porta única das vendas confirmando o Pix)
       * passava despercebida: o lançamento ficava CANCELADO com baixa VIVA —
       * o DRE e o fluxo pulam a parcela, mas o extrato continua somando a
       * baixa, e o saldo da conta diverge do relatório para sempre, sem
       * pista de onde (achado da auditoria completa, 03/09/2026).
       */
      try {
        const recusa = await db.$transaction(
          async (tx) => {
            if (corpo.cancelar) {
              const agora = await tx.finLancamento.findFirstOrThrow({
                where: { id, companyId: porta.user.companyId },
                include: { parcelas: { include: { baixas: true } } },
              });
              const impedimento = podeCancelarLancamento(agora.parcelas);
              if (impedimento) return impedimento;
            }
            await tx.finLancamento.update({
              where: { id },
              data: {
                canceladoEm: corpo.cancelar ? new Date() : null,
                eventos: {
                  create: {
                    descricao: corpo.cancelar
                      ? "Lançamento cancelado"
                      : "Lançamento reaberto",
                    autorNome: porta.user.name,
                  },
                },
              },
            });
            return null;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 20_000,
            maxWait: 10_000,
          }
        );
        if (recusa) return NextResponse.json({ error: recusa }, { status: 409 });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === "P2034" || code === "P2028")
          return NextResponse.json(
            { error: "Alguém mexeu neste lançamento agora mesmo — tente de novo" },
            { status: 409 }
          );
        throw e;
      }
      return NextResponse.json({ ok: true });
    }

    // ---- editar a ficha inteira -------------------------------------------
    // O LADO NÃO MUDA numa edição: virar uma conta a receber em conta a
    // pagar inverte o sinal no DRE, some da tela em que ela estava e ainda
    // apaga o cliente (receita tem cliente, despesa tem fornecedor). A tela
    // nunca ofereceu isso; a rota aceitava.
    if (corpo.tipo !== atual.tipo)
      return NextResponse.json(
        {
          error:
            "Não dá para trocar o lado do lançamento. Cancele este e lance do outro lado.",
        },
        { status: 400 }
      );
    // e lançamento CANCELADO não se edita: a tela esconde o botão, a rota
    // também precisa dizer não
    if (atual.canceladoEm)
      return NextResponse.json(
        { error: "Este lançamento está cancelado — reabra antes de editar" },
        { status: 409 }
      );

    const impedimento = podeEditarValores(atual.parcelas, atual.origem);
    if (impedimento)
      return NextResponse.json({ error: impedimento }, { status: 409 });

    const conferido = await conferirLancamento(porta.user.companyId, corpo);
    if ("erro" in conferido)
      return NextResponse.json({ error: conferido.erro }, { status: 400 });

    /**
     * A MESMA TRAVA DA EDIÇÃO: refazer as parcelas as APAGA, e o cascade
     * leva junto as baixas e a conciliação penduradas nelas. Conferindo de
     * fora, uma baixa que chegasse no meio sumia sem nenhuma linha de
     * histórico — o oposto do "o histórico do dinheiro não se reescreve"
     * (RN-030).
     */
    try {
      const recusa = await db.$transaction(
        async (tx) => {
          const agora = await tx.finLancamento.findFirstOrThrow({
            where: { id, companyId: porta.user.companyId },
            include: { parcelas: { include: { baixas: true } } },
          });
          const trava = podeEditarValores(agora.parcelas, agora.origem);
          if (trava) return trava;
          await tx.finParcela.deleteMany({ where: { lancamentoId: id } });
          await tx.finLancamento.update({
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
          });
          return null;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
          maxWait: 10_000,
        }
      );
      if (recusa) return NextResponse.json({ error: recusa }, { status: 409 });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "P2034" || code === "P2028")
        return NextResponse.json(
          { error: "Alguém mexeu neste lançamento agora mesmo — tente de novo" },
          { status: 409 }
        );
      throw e;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
