import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePlanoCorte, planoCorteErro } from "@/lib/plano-corte-auth";
import type { PecaModelo } from "@/lib/plano-corte/types";

/** Detalhe completo do modelo (peças com medidas), correção e exclusão. */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const m = await db.cutPlanModel.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    return NextResponse.json({
      id: m.id,
      name: m.name,
      source: m.source,
      thumbnail: m.thumbnail,
      sizes: JSON.parse(m.sizes),
      pieces: JSON.parse(m.pieces),
      createdAt: m.createdAt.toISOString(),
    });
  } catch (e) {
    return planoCorteErro(e);
  }
}

/**
 * Corrige a ficha do modelo: quantas vezes cada peça é cortada por roupa e
 * em que pano ela sai. O Audaces nem sempre declara o par (manga, alça,
 * bolso) de forma legível — aqui o lojista acerta e fica valendo pra
 * sempre, sem precisar reimportar o arquivo.
 */
const patchSchema = z.object({
  pecas: z
    .array(
      z.object({
        nome: z.string().min(1).max(160),
        qtd: z.number().int().min(1).max(50).optional(),
        pano: z.enum(["TEC", "FOR"]).optional(),
        // par espelhado: a 2ª peça sai invertida (mão esquerda/direita)
        espelhada: z.boolean().optional(),
      })
    )
    .min(1)
    .max(100),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    const m = await db.cutPlanModel.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });

    const pecas = JSON.parse(m.pieces) as PecaModelo[];
    for (const ajuste of parsed.data.pecas) {
      const peca = pecas.find((p) => p.nome === ajuste.nome);
      if (!peca) continue; // peça renomeada/removida: ignora em silêncio
      if (ajuste.qtd !== undefined) peca.qtd = ajuste.qtd;
      if (ajuste.pano !== undefined) peca.pano = ajuste.pano;
      if (ajuste.espelhada !== undefined) peca.espelhada = ajuste.espelhada;
      // peça com 1 por roupa não tem par pra espelhar
      if (peca.qtd < 2) peca.espelhada = false;
    }
    await db.cutPlanModel.update({
      where: { id: m.id },
      data: { pieces: JSON.stringify(pecas) },
    });
    return NextResponse.json({ ok: true, pieces: pecas });
  } catch (e) {
    return planoCorteErro(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePlanoCorte();
    const { id } = await params;
    const m = await db.cutPlanModel.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!m)
      return NextResponse.json({ error: "Modelo não encontrado" }, { status: 404 });
    await db.cutPlanModel.delete({ where: { id: m.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return planoCorteErro(e);
  }
}
