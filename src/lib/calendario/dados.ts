import { db } from "../db";
import { dataDoDia } from "../dia";
import {
  montarOcorrencias,
  segmentosValidos,
  type EventoGravado,
  type Ocorrencia,
} from "./datas";

export { intervaloDaTela, janelaDoLembrete } from "./datas";

/**
 * O CALENDÁRIO DA LOJA, lido do banco (RN-092). Tudo recortado pela loja
 * (RN-013). As datas do sistema são calculadas; do banco vêm só as datas
 * que a loja criou e as anotações (notas, tarefas, antecedência própria,
 * carimbo do lembrete) das datas do sistema.
 */

export type ConfigDoCalendario = {
  antecedenciaDias: number;
  segmentos: string[];
  ocultas: string[];
};

export async function configDoCalendario(companyId: string): Promise<ConfigDoCalendario> {
  const c = await db.company.findUnique({
    where: { id: companyId },
    select: {
      calendarioAntecedenciaDias: true,
      calendarioSegmentos: true,
      calendarioOcultas: true,
    },
  });
  return {
    antecedenciaDias: c?.calendarioAntecedenciaDias ?? 45,
    segmentos: segmentosValidos(c?.calendarioSegmentos ?? []),
    ocultas: c?.calendarioOcultas ?? [],
  };
}

/** "2026-05-10" a partir do carimbo do meio-dia UTC (régua de lib/dia.ts). */
const diaDoCarimbo = (d: Date) => d.toISOString().slice(0, 10);

/** As datas da loja e as anotações que tocam o intervalo [de, ate]. */
async function eventosDoIntervalo(companyId: string, de: string, ate: string): Promise<EventoGravado[]> {
  const inicio = dataDoDia(de)!;
  const fim = dataDoDia(ate)!;
  const linhas = await db.calendarioEvento.findMany({
    where: {
      companyId,
      OR: [
        { chaveSistema: null, data: { gte: inicio, lte: fim } },
        { chaveSistema: { not: null }, ano: { gte: Number(de.slice(0, 4)), lte: Number(ate.slice(0, 4)) } },
      ],
    },
    include: { tarefas: { orderBy: [{ ordem: "asc" }, { createdAt: "asc" }] } },
  });
  return linhas.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    titulo: e.titulo,
    dia: diaDoCarimbo(e.data),
    antecedenciaDias: e.antecedenciaDias,
    notas: e.notas,
    chaveSistema: e.chaveSistema,
    ano: e.ano,
    avisadoEm: e.avisadoEm?.toISOString() ?? null,
    tarefas: e.tarefas.map((t) => ({
      id: t.id,
      texto: t.texto,
      feita: t.feita,
      feitaPorNome: t.feitaPorNome,
    })),
  }));
}

export async function carregarCalendario(
  companyId: string,
  de: string,
  ate: string
): Promise<{ config: ConfigDoCalendario; ocorrencias: Ocorrencia[] }> {
  const [config, eventos] = await Promise.all([
    configDoCalendario(companyId),
    eventosDoIntervalo(companyId, de, ate),
  ]);
  const ocorrencias = montarOcorrencias({
    de,
    ate,
    segmentos: config.segmentos,
    ocultas: config.ocultas,
    eventos,
  });
  return { config, ocorrencias };
}
