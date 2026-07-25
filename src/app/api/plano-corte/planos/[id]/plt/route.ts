import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { riscoParaPlt } from "@/lib/plano-corte/plt";
import type { ResultadoPlano } from "@/lib/plano-corte/types";

/**
 * Baixa o PLT (HPGL, escala real 1:1) de um risco do plano salvo.
 * Query: ?pano=TEC|FOR&risco=0 — um arquivo por risco, igual o fluxo da
 * plotter: imprime risco A, enfesta, imprime risco B...
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const url = new URL(req.url);
    const pano = url.searchParams.get("pano") ?? "TEC";
    const idx = parseInt(url.searchParams.get("risco") ?? "0", 10);

    const run = await db.cutPlanRun.findFirst({
      where: { id, companyId: user.companyId },
      include: { model: { select: { name: true } } },
    });
    if (!run)
      return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });

    const resultado = JSON.parse(run.result) as ResultadoPlano;
    const plano = resultado.planos.find((p) => p.pano === pano);
    const risco = plano?.riscos[idx];
    if (!risco)
      return NextResponse.json({ error: "Risco não encontrado" }, { status: 404 });

    const plt = riscoParaPlt(risco, run.name ?? run.model?.name ?? "PLANO");
    const nomeArq = `risco-${(run.name ?? run.model?.name ?? "plano").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${pano.toLowerCase()}-${idx + 1}.plt`;

    return new NextResponse(plt, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${nomeArq}"`,
      },
    });
  } catch (e) {
    return planoCorteErro(e);
  }
}
