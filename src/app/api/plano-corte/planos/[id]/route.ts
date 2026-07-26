import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { riscoParaSvg } from "@/lib/plano-corte/svg";
import { progressoDoRun, type ParamsJob } from "@/lib/plano-corte/job";
import { resumoDeCorte } from "@/lib/plano-corte/resumo";
import type { ResultadoPlano } from "@/lib/plano-corte/types";
import type { EstadoOtimizacao } from "@/lib/plano-corte/otimizador";

/**
 * Detalhe do plano: progresso + melhor resultado até agora, com o SVG de
 * cada risco pronto pra desenhar (a tela usa tanto DURANTE a otimização —
 * plano melhorando ao vivo — quanto no resultado final).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const run = await db.cutPlanRun.findFirst({
      where: { id, companyId: user.companyId },
      include: { model: { select: { name: true } } },
    });
    if (!run)
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });

    let resultado: ResultadoPlano | null = null;
    let estado: EstadoOtimizacao | null = null;
    try {
      resultado = JSON.parse(run.result);
    } catch {}
    try {
      estado = run.state ? JSON.parse(run.state) : null;
    } catch {}
    const paramsJob = (() => {
      try {
        return JSON.parse(run.params) as ParamsJob;
      } catch {
        return null;
      }
    })();

    return NextResponse.json({
      ...progressoDoRun(run, resultado, estado),
      modelName: run.model?.name ?? null,
      params: paramsJob,
      resultado: resultado
        ? {
            ...resultado,
            // contagem de peças pra conferir na mesa (calculada aqui porque
            // as posições completas não vão pra tela)
            resumo: resumoDeCorte(resultado.planos),
            planos: resultado.planos.map((p) => ({
              ...p,
              riscos: p.riscos.map((r) => ({
                ...r,
                svg: riscoParaSvg(r),
                pecas: undefined, // posições completas não precisam ir pra tela
              })),
            })),
          }
        : null,
    });
  } catch (e) {
    return planoCorteErro(e);
  }
}

/** Apaga um plano (concluído ou não) — some da fila e do histórico. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const run = await db.cutPlanRun.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!run)
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });
    await db.cutPlanRun.delete({ where: { id: run.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return planoCorteErro(e);
  }
}
