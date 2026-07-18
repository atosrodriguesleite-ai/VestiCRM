import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

/**
 * Saldo inicial da costura — implantação em fábrica que já roda: as peças
 * cortadas ANTES do sistema existir entram aqui (sem corte de origem) e
 * seguem o fluxo normal: montou → conferiu → lançou no estoque real.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = z
      .object({
        productName: z.string().min(1).max(120),
        color: z.string().max(60).nullable().optional(),
        size: z.string().max(30).nullable().optional(),
        pieces: z.number().int().positive().max(1000000),
      })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;
    const item = await db.sewingItem.create({
      data: {
        companyId: user.companyId,
        cutId: null,
        cutCode: null, // sem corte de origem = saldo anterior ao sistema
        productName: d.productName.trim(),
        color: d.color?.trim() || null,
        size: d.size?.trim() || null,
        cutPieces: d.pieces,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
