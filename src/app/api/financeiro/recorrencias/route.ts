import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { porteiraFinanceiro } from "@/lib/financeiro/gate";
import {
  conferirRecorrencia,
  recorrenciaSchema,
} from "@/lib/financeiro/recorrencia-form";
import { garantirRecorrencias } from "@/lib/financeiro/recorrencia";

/**
 * CRIAR CONTA FIXA (RN-031). Assim que nasce, já materializa os próximos
 * meses — a lojista cadastra o aluguel e ele aparece na lista na hora, sem
 * "espere o sistema rodar".
 */
export async function POST(req: NextRequest) {
  try {
    const porta = await porteiraFinanceiro();
    if (!porta.ok) return porta.resposta;
    const parsed = recorrenciaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const conferido = await conferirRecorrencia(porta.user.companyId, parsed.data);
    if ("erro" in conferido)
      return NextResponse.json({ error: conferido.erro }, { status: 400 });

    const r = await db.finRecorrencia.create({
      data: { companyId: porta.user.companyId, ...conferido.data },
      select: { id: true },
    });
    const criados = await garantirRecorrencias(porta.user.companyId);
    return NextResponse.json({ id: r.id, lancamentosCriados: criados });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
