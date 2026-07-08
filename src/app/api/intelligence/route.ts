import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import {
  periodFromDays,
  previousPeriod,
  overview,
  funnel,
  channelRanking,
  sellerRanking,
  campaignRanking,
  productStats,
  categoryStats,
  colorStats,
  sizeStats,
  heatmaps,
  recovery,
  alerts,
} from "@/lib/tracking/insights";

/**
 * API da Inteligência Comercial — expõe TODOS os dados via Tracking Engine.
 * Nenhum relatório consulta o banco diretamente; tudo sai daqui (ou das
 * mesmas funções de insights usadas pela página).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const days = Number(req.nextUrl.searchParams.get("dias") ?? 30);
    const period = periodFromDays([1, 7, 30, 90, 365].includes(days) ? days : 30);
    const prev = previousPeriod(period);
    const companyId = user.companyId;

    const [now, before, funil, canais, vendedores, campanhas, produtos, categorias, cores, tamanhos, mapas, recuperacao, alertas] =
      await Promise.all([
        overview(companyId, period),
        overview(companyId, prev),
        funnel(companyId, period),
        channelRanking(companyId, period),
        sellerRanking(companyId, period),
        campaignRanking(companyId, period),
        productStats(companyId, period),
        categoryStats(companyId, period),
        colorStats(companyId, period),
        sizeStats(companyId, period),
        heatmaps(companyId, period),
        recovery(companyId, period),
        alerts(companyId, period),
      ]);

    return NextResponse.json({
      periodo: { dias: days, de: period.from, ate: period.to },
      visaoGeral: now,
      periodoAnterior: before,
      funil,
      canais,
      vendedores,
      campanhas,
      produtos,
      categorias,
      cores,
      tamanhos,
      heatmaps: mapas,
      recuperacao,
      alertas,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
