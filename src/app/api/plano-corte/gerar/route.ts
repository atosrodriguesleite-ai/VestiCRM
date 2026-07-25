import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import { rodarRodada } from "@/lib/plano-corte/otimizador";
import {
  BUDGET_POR_MODO,
  MAX_PLANOS_SIMULTANEOS,
  carregarItens,
  progressoDoRun,
  type ParamsJob,
} from "@/lib/plano-corte/job";
import type { ParametrosPlano } from "@/lib/plano-corte/types";

export const maxDuration = 60;

/**
 * Cria um PLANO DE CORTE como job de otimização: valida o pedido (vários
 * modelos, mesma largura de tecido), roda a primeira rodada (o plano base
 * aparece em segundos) e devolve o job pra tela ir chamando /rodada até o
 * orçamento de tempo do modo escolhido acabar.
 */

const itemSchema = z.object({
  modelId: z.string().min(1),
  grade: z.record(z.string(), z.number().int().min(0).max(100000)),
  pecasDesligadas: z.array(z.string().max(160)).max(100).default([]),
});

const schema = z.object({
  nome: z.string().max(80).optional(),
  modo: z.enum(["RAPIDO", "NORMAL", "CAPRICHADO"]).default("NORMAL"),
  itens: z.array(itemSchema).min(1).max(6),
  larguraTecidoCm: z.number().min(20).max(400),
  larguraForroCm: z.number().min(20).max(400).optional(),
  mesaCm: z.number().min(50).max(10000),
  folgaCm: z.number().min(0).max(10).default(0.5),
  maxFolhas: z.number().int().min(1).max(500).default(60),
  perdaPorFolhaCm: z.number().min(0).max(50).default(3),
  incluirForro: z.boolean().default(true),
  sentidoUnico: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlanoCorte();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    const d = parsed.data;

    // fila: no máximo N planos "pensando" ao mesmo tempo por loja
    const rodando = await db.cutPlanRun.count({
      where: { companyId: user.companyId, status: "EM_ANDAMENTO" },
    });
    if (rodando >= MAX_PLANOS_SIMULTANEOS)
      return NextResponse.json(
        {
          error: `Já existem ${rodando} planos calculando — espere um terminar (ou pare um deles) pra começar outro`,
        },
        { status: 409 }
      );

    const params: ParamsJob = {
      itens: d.itens,
      grade: {}, // a grade real vive em itens[]; este campo fica vazio no job
      larguraTecidoCm: d.larguraTecidoCm,
      larguraForroCm: d.larguraForroCm,
      mesaCm: d.mesaCm,
      folgaCm: d.folgaCm,
      maxFolhas: d.maxFolhas,
      perdaPorFolhaCm: d.perdaPorFolhaCm,
      incluirForro: d.incluirForro,
      pecasDesligadas: [],
      sentidoUnico: d.sentidoUnico,
    };

    let itens;
    try {
      itens = await carregarItens(user.companyId, params);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Modelo não encontrado";
      return NextResponse.json({ error: msg }, { status: 404 });
    }

    const budgetMs = BUDGET_POR_MODO[d.modo];

    // primeira rodada inline: a fase BASE devolve um plano completo em
    // segundos — a tela já mostra algo antes da primeira /rodada
    let rodada;
    try {
      rodada = rodarRodada(itens, params as ParametrosPlano, null, null, budgetMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui montar o plano";
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    const concluiu = rodada.estado.fase === "DONE";
    const run = await db.cutPlanRun.create({
      data: {
        companyId: user.companyId,
        modelId: d.itens[0].modelId,
        name: d.nome ?? null,
        status: concluiu ? "CONCLUIDO" : "EM_ANDAMENTO",
        mode: d.modo,
        budgetMs,
        elapsedMs: rodada.estado.elapsedMs,
        attempts: rodada.estado.tentativas,
        state: JSON.stringify(rodada.estado),
        params: JSON.stringify(params),
        result: JSON.stringify(rodada.resultado),
      },
    });

    return NextResponse.json(progressoDoRun(run, rodada.resultado, rodada.estado));
  } catch (e) {
    return planoCorteErro(e);
  }
}

/** Lista pra fila (em andamento) + histórico (últimos concluídos). */
export async function GET() {
  try {
    const user = await requirePlanoCorte();
    const runs = await db.cutPlanRun.findMany({
      where: { companyId: user.companyId },
      include: { model: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }], // CONCLUIDO < EM_ANDAMENTO alfabeticamente? não: ordena por data mesmo
      take: 40,
    });
    return NextResponse.json(
      runs
        .sort((a, b) => {
          // em andamento primeiro, depois mais recentes
          if (a.status === "EM_ANDAMENTO" && b.status !== "EM_ANDAMENTO") return -1;
          if (b.status === "EM_ANDAMENTO" && a.status !== "EM_ANDAMENTO") return 1;
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .map((r) => {
          let resultado = null;
          let estado = null;
          try {
            resultado = JSON.parse(r.result);
          } catch {}
          try {
            estado = r.state ? JSON.parse(r.state) : null;
          } catch {}
          const params = (() => {
            try {
              return JSON.parse(r.params) as ParamsJob;
            } catch {
              return null;
            }
          })();
          return {
            ...progressoDoRun(r, resultado, estado),
            modelName: r.model?.name ?? null,
            modelos: params?.itens.length ?? 1,
            totalPecasRoupa: resultado?.totalPecasRoupa ?? 0,
          };
        })
    );
  } catch (e) {
    return planoCorteErro(e);
  }
}
