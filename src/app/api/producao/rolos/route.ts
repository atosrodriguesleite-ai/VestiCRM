import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

const schema = z.object({
  fabricId: z.string().min(1),
  color: z.string().min(1).max(60),
  lotCode: z.string().max(60).nullable().optional(),
  weightKg: z.number().positive().max(10000),
  pricePerKg: z.number().nonnegative().max(100000),
  notes: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const fabric = await db.fabric.findFirst({
      where: { id: parsed.data.fabricId, companyId: user.companyId },
    });
    if (!fabric) {
      return NextResponse.json({ error: "Tecido não encontrado" }, { status: 404 });
    }
    const roll = await db.fabricRoll.create({
      data: { ...parsed.data, remainingKg: parsed.data.weightKg },
    });
    return NextResponse.json(roll, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
