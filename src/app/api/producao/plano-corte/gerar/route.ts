import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { montarPlano } from "@/lib/plano-corte/enfesto";
import { riscoParaSvg } from "@/lib/plano-corte/svg";
import type { ModeloCorte, ParametrosPlano } from "@/lib/plano-corte/types";

/**
 * Gera o plano de corte: recebe grade + mesa + tecido, roda o otimizador
 * (várias estratégias de enfesto × várias ordens de encaixe) e devolve os
 * riscos com SVG pronto pra tela. O plano fica salvo pra reabrir e pra
 * baixar o PLT depois.
 */

const schema = z.object({
  modelId: z.string().min(1),
  grade: z.record(z.string(), z.number().int().min(0).max(100000)),
  larguraTecidoCm: z.number().min(20).max(400),
  larguraForroCm: z.number().min(20).max(400).optional(),
  mesaCm: z.number().min(50).max(10000),
  folgaCm: z.number().min(0).max(10).default(0.5),
  maxFolhas: z.number().int().min(1).max(500).default(60),
  perdaPorFolhaCm: z.number().min(0).max(50).default(3),
  incluirForro: z.boolean().default(true),
  pecasDesligadas: z.array(z.string().max(120)).max(100).default([]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
    const d = parsed.data;

    const m = await db.cutPlanModel.findFirst({
      where: { id: d.modelId, companyId: user.companyId },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    const modelo: ModeloCorte = {
      nome: m.name,
      origem: m.source as ModeloCorte["origem"],
      tamanhos: JSON.parse(m.sizes),
      pecas: JSON.parse(m.pieces),
    };

    const params: ParametrosPlano = {
      grade: d.grade,
      larguraTecidoCm: d.larguraTecidoCm,
      larguraForroCm: d.larguraForroCm,
      mesaCm: d.mesaCm,
      folgaCm: d.folgaCm,
      maxFolhas: d.maxFolhas,
      perdaPorFolhaCm: d.perdaPorFolhaCm,
      incluirForro: d.incluirForro,
      pecasDesligadas: d.pecasDesligadas,
    };

    let resultado;
    try {
      resultado = montarPlano(modelo, params);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não consegui montar o plano";
      return NextResponse.json({ error: msg }, { status: 422 });
    }

    const salvo = await db.cutPlanRun.create({
      data: {
        companyId: user.companyId,
        modelId: m.id,
        params: JSON.stringify(params),
        result: JSON.stringify(resultado),
      },
    });

    // SVG gerado na resposta (não persiste: redesenha rápido do resultado)
    return NextResponse.json({
      id: salvo.id,
      modelName: m.name,
      resultado: {
        ...resultado,
        planos: resultado.planos.map((p) => ({
          ...p,
          riscos: p.riscos.map((r) => ({
            ...r,
            svg: riscoParaSvg(r),
            // as posições completas não precisam trafegar pra tela
            pecas: undefined,
          })),
        })),
      },
    });
  } catch (e) {
    return producaoErro(e);
  }
}

export async function GET() {
  try {
    const user = await requireProducao();
    const runs = await db.cutPlanRun.findMany({
      where: { companyId: user.companyId },
      include: { model: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return NextResponse.json(
      runs.map((r) => {
        const res = JSON.parse(r.result) as {
          planos: { pano: string; totalTecidoCm: number; riscos: unknown[] }[];
          totalPecasRoupa: number;
        };
        return {
          id: r.id,
          modelName: r.model.name,
          createdAt: r.createdAt.toISOString(),
          totalPecasRoupa: res.totalPecasRoupa,
          panos: res.planos.map((p) => ({
            pano: p.pano,
            totalM: Math.round(p.totalTecidoCm / 10) / 10,
            riscos: p.riscos.length,
          })),
        };
      })
    );
  } catch (e) {
    return producaoErro(e);
  }
}
