import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import { pagarFatura } from "@/lib/financeiro/cartao";
import { dataDoDia } from "@/lib/financeiro/lancamentos";

const schema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  contaId: z.string().min(1),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * PAGAR A FATURA DO CARTÃO (RN-037): dá baixa em todas as compras dela de uma
 * vez, na conta de onde o dinheiro sai. Porta do módulo (RN-027).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const data = dataDoDia(parsed.data.data);
    if (!data)
      return NextResponse.json({ error: "Data inválida" }, { status: 400 });

    const r = await pagarFatura(
      porta.user.companyId,
      { cartaoId: id, mes: parsed.data.mes, contaId: parsed.data.contaId, data },
      porta.user.name
    );
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
