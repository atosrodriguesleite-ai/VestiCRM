import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { progressoDoRun } from "@/lib/plano-corte/job";
import type { EstadoOtimizacao } from "@/lib/plano-corte/otimizador";

/**
 * "Parar e usar esse": encerra a otimização AGORA e fica com o melhor
 * plano encontrado até o momento — pra quando o resultado já está bom e
 * não vale esperar o resto do orçamento de tempo.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const run = await db.cutPlanRun.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!run)
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });

    let estado: EstadoOtimizacao | null = null;
    try {
      estado = run.state ? JSON.parse(run.state) : null;
    } catch {}
    if (estado) estado.fase = "DONE";

    const salvo = await db.cutPlanRun.update({
      where: { id: run.id },
      data: {
        status: "CONCLUIDO",
        state: estado ? JSON.stringify({ ...estado, lockUntil: 0 }) : run.state,
      },
    });

    let resultado = null;
    try {
      resultado = JSON.parse(salvo.result);
    } catch {}
    return NextResponse.json(progressoDoRun(salvo, resultado, estado));
  } catch (e) {
    return planoCorteErro(e);
  }
}
