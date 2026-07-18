import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

const schema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().max(40).nullable().optional(),
  type: z.string().max(40).nullable().optional(),
  supplier: z.string().max(80).nullable().optional(),
  grammage: z.number().int().positive().nullable().optional(),
  composition: z.string().max(120).nullable().optional(),
  widthM: z.number().positive().max(10),
  yieldMPerKg: z.number().positive().max(100),
  notes: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const fabric = await db.fabric.create({
      data: { companyId: user.companyId, ...parsed.data },
    });
    return NextResponse.json(fabric, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
