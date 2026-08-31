import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  conferirRecorrencia,
  recorrenciaSchema,
} from "@/lib/financeiro/recorrencia-form";
import {
  garantirRecorrencias,
  limparFuturosSemBaixa,
  mesDe,
  somarMeses,
  vencimentoDoMes,
} from "@/lib/financeiro/recorrencia";

/**
 * EDITAR ou ENCERRAR a conta fixa (RN-029).
 *
 * Editar mexe SÓ NO FUTURO: os meses que ainda não venceram e não têm baixa
 * são refeitos com os valores novos; o que já foi pago fica exatamente como
 * está. É a tradução honesta do "esta e as próximas" — o passado não se
 * reescreve, e o aluguel de agosto continua tendo sido o de agosto.
 *
 * Encerrar (ativa: false) para de gerar daqui para frente e limpa os meses
 * futuros ainda não pagos; sem DELETE, como todo o módulo.
 */

const patchSchema = z.union([
  recorrenciaSchema,
  z.object({ ativa: z.boolean() }),
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

    const atual = await db.finRecorrencia.findFirst({
      where: { id, companyId: porta.user.companyId },
    });
    if (!atual)
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

    // a partir de qual mês o futuro pode ser refeito: o mês corrente
    const inicioDoFuturo = vencimentoDoMes(mesDe(new Date()), 1);

    if ("ativa" in parsed.data) {
      await db.finRecorrencia.update({
        where: { id },
        data: {
          ativa: parsed.data.ativa,
          // REATIVAR recua o relógio da geração: o encerramento apagou os
          // meses futuros, e sem recuar eles nunca voltariam — a conta fixa
          // ficaria "ativa" e invisível nas contas a pagar
          ...(parsed.data.ativa ? { geradoAte: somarMeses(mesDe(new Date()), -1) } : {}),
        },
      });
      if (!parsed.data.ativa) {
        await limparFuturosSemBaixa(porta.user.companyId, id, inicioDoFuturo);
      } else {
        await garantirRecorrencias(porta.user.companyId);
      }
      return NextResponse.json({ ok: true });
    }

    const conferido = await conferirRecorrencia(porta.user.companyId, parsed.data);
    if ("erro" in conferido)
      return NextResponse.json({ error: conferido.erro }, { status: 400 });

    const removidos = await limparFuturosSemBaixa(
      porta.user.companyId,
      id,
      inicioDoFuturo
    );
    await db.finRecorrencia.update({
      where: { id },
      data: {
        ...conferido.data,
        // o relógio da geração volta para o mês ANTERIOR ao atual: o futuro
        // que acabou de ser limpo é refeito com os valores novos, e os meses
        // passados (que continuam no banco) não são reprocessados à toa
        geradoAte: somarMeses(mesDe(new Date()), -1),
      },
    });
    const criados = await garantirRecorrencias(porta.user.companyId);
    return NextResponse.json({ ok: true, removidos, criados });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
