import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

/** Cadastro de facções de costura (nome, contato, preço por peça). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = z
      .object({
        name: z.string().min(1).max(80),
        contact: z.string().max(120).nullable().optional(),
        pricePerPiece: z.number().nonnegative().max(100000).optional(),
      })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const f = await db.sewingFaction.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name.trim(),
        contact: parsed.data.contact?.trim() || null,
        pricePerPiece: parsed.data.pricePerPiece ?? 0,
      },
    });
    return NextResponse.json(f, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
