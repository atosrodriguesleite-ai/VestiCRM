import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isSupport } from "@/lib/scope";
import { evaluateSegment, rfmLiberadoPara, type SegmentFilter } from "@/lib/segments";

/** Retorna quantos (e quais) clientes um filtro de campanha alcança. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // Suporte não mexe em campanhas (a tela já bloqueia; a API não)
    if (isSupport(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const filter = (await req.json().catch(() => ({}))) as SegmentFilter;
    // RN-098: a prévia não vira porta dos fundos do RFM (o público seria
    // vazio de qualquer jeito; a recusa diz por quê)
    if (filter?.rfmGrupo != null && !(await rfmLiberadoPara(user))) {
      return NextResponse.json(
        { error: "O grupo do RFM é da gerência, nas lojas com o BI de Vendas." },
        { status: 403 }
      );
    }
    const customers = await evaluateSegment(user, filter);
    return NextResponse.json({
      count: customers.length,
      sample: customers.slice(0, 8),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
