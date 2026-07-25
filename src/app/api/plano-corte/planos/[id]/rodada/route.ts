import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { rodarRodada, type EstadoOtimizacao } from "@/lib/plano-corte/otimizador";
import { carregarItens, progressoDoRun, type ParamsJob } from "@/lib/plano-corte/job";
import type { ParametrosPlano, ResultadoPlano } from "@/lib/plano-corte/types";

export const maxDuration = 60;

/**
 * Executa UMA rodada de otimização do plano (~9s de cálculo; a fase de
 * polimento pode levar mais) e salva o progresso. A tela chama esta rota
 * em sequência até status CONCLUIDO — é isso que move a barra.
 *
 * Trava simples contra rodadas simultâneas do MESMO plano (duas abas):
 * um `lockUntil` dentro do estado; rodada chamada com trava ativa devolve
 * o progresso atual sem calcular.
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

    let estado: (EstadoOtimizacao & { lockUntil?: number }) | null = null;
    let resultado: ResultadoPlano | null = null;
    try {
      estado = run.state ? JSON.parse(run.state) : null;
    } catch {}
    try {
      resultado = JSON.parse(run.result);
    } catch {}

    if (run.status !== "EM_ANDAMENTO")
      return NextResponse.json(progressoDoRun(run, resultado, estado));

    // trava anti-aba-dupla: se outra rodada está no meio, só reporta
    const agora = Date.now();
    if (estado?.lockUntil && estado.lockUntil > agora)
      return NextResponse.json(progressoDoRun(run, resultado, estado));

    // arma a trava antes do cálculo pesado
    if (estado) {
      await db.cutPlanRun.update({
        where: { id: run.id },
        data: { state: JSON.stringify({ ...estado, lockUntil: agora + 55_000 }) },
      });
    }

    const paramsJob = JSON.parse(run.params) as ParamsJob;
    const itens = await carregarItens(user.companyId, paramsJob);

    const rodada = rodarRodada(
      itens,
      paramsJob as ParametrosPlano,
      estado,
      resultado,
      run.budgetMs
    );

    const concluiu = rodada.estado.fase === "DONE";
    const salvo = await db.cutPlanRun.update({
      where: { id: run.id },
      data: {
        status: concluiu ? "CONCLUIDO" : "EM_ANDAMENTO",
        elapsedMs: rodada.estado.elapsedMs,
        attempts: rodada.estado.tentativas,
        state: JSON.stringify({ ...rodada.estado, lockUntil: 0 }),
        result: JSON.stringify(rodada.resultado),
      },
    });

    return NextResponse.json(progressoDoRun(salvo, rodada.resultado, rodada.estado));
  } catch (e) {
    return planoCorteErro(e);
  }
}
