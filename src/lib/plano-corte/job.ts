import { db } from "../db";
import type { ItemPedido } from "./enfesto";
import type { ModeloCorte, ParametrosPlano, ResultadoPlano } from "./types";
import { aproveitamentoManchete, type EstadoOtimizacao } from "./otimizador";

/**
 * Job de plano de corte — apoio das rotas: carrega os modelos do plano,
 * monta o resumo de progresso da barra e define os orçamentos de tempo
 * dos modos ("quanto tempo o sistema pensa").
 */

export type ItemJob = {
  modelId: string;
  grade: Record<string, number>;
  pecasDesligadas?: string[];
};

/** O que fica gravado em CutPlanRun.params. */
export type ParamsJob = ParametrosPlano & { itens: ItemJob[] };

export const BUDGET_POR_MODO: Record<string, number> = {
  RAPIDO: 30_000, // ~30s de cálculo
  NORMAL: 180_000, // ~3min
  CAPRICHADO: 600_000, // ~10min
};

/** Máximo de planos otimizando ao mesmo tempo por loja. */
export const MAX_PLANOS_SIMULTANEOS = 3;

/** Carrega os modelos citados no job (sempre no escopo da loja). */
export async function carregarItens(
  companyId: string,
  params: ParamsJob
): Promise<ItemPedido[]> {
  const ids = [...new Set(params.itens.map((i) => i.modelId))];
  const modelos = await db.cutPlanModel.findMany({
    where: { id: { in: ids }, companyId },
  });
  const porId = new Map(modelos.map((m) => [m.id, m]));
  return params.itens.map((i) => {
    const m = porId.get(i.modelId);
    if (!m) throw new Error("Um dos modelos do plano não existe mais");
    const modelo: ModeloCorte = {
      nome: m.name,
      origem: m.source as ModeloCorte["origem"],
      tamanhos: JSON.parse(m.sizes),
      pecas: JSON.parse(m.pieces),
    };
    return { modelo, grade: i.grade, pecasDesligadas: i.pecasDesligadas };
  });
}

type RunRow = {
  id: string;
  name: string | null;
  status: string;
  mode: string | null;
  budgetMs: number;
  elapsedMs: number;
  attempts: number;
  createdAt: Date;
};

/** Resumo de progresso que alimenta barra, cronômetro e frases da tela. */
export function progressoDoRun(
  run: RunRow,
  resultado: ResultadoPlano | null,
  estado: EstadoOtimizacao | null
) {
  const pct =
    run.status !== "EM_ANDAMENTO"
      ? 100
      : run.budgetMs > 0
        ? Math.min(99, Math.round((run.elapsedMs / run.budgetMs) * 100))
        : 0;
  return {
    id: run.id,
    nome: run.name,
    status: run.status,
    modo: run.mode,
    pct,
    budgetMs: run.budgetMs,
    elapsedMs: run.elapsedMs,
    restanteMs: Math.max(0, run.budgetMs - run.elapsedMs),
    tentativas: run.attempts,
    fase: estado?.fase ?? null,
    criadoEm: run.createdAt.toISOString(),
    aproveitamento: resultado ? aproveitamentoManchete(resultado) : null,
    panos:
      resultado?.planos.map((p) => ({
        pano: p.pano,
        totalM: Math.round(p.totalTecidoCm / 10) / 10,
        riscos: p.riscos.length,
        aproveitamento: p.aproveitamentoMedio,
      })) ?? [],
  };
}
