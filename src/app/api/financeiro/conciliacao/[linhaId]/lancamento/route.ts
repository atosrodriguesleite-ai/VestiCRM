import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { lancamentoSchema } from "@/lib/financeiro/lancamento-form";
import { criarLancamentoDaLinha } from "@/lib/financeiro/conciliacao";

/**
 * CRIAR O LANÇAMENTO QUE FALTAVA, DIRETO DA LINHA DO BANCO (RN-037).
 *
 * A ficha é a MESMA de Contas a Pagar/Receber (RN-030, mesmo schema e mesmo
 * validador) — o que muda é que o valor, a data e a conta vêm do extrato, e o
 * lançamento já nasce baixado e conferido com aquela linha.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ linhaId: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { linhaId } = await params;
    const parsed = lancamentoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const r = await criarLancamentoDaLinha(
      porta.user.companyId,
      linhaId,
      parsed.data,
      porta.user.name
    );
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json({
      id: r.lancamentoId,
      baixado: r.baixado,
      conciliada: r.conciliada,
      falta: r.falta,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
