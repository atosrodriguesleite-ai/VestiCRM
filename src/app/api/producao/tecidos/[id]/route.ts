import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  code: z.string().max(40).nullable().optional(),
  type: z.string().max(40).nullable().optional(),
  supplier: z.string().max(80).nullable().optional(),
  grammage: z.number().int().positive().nullable().optional(),
  composition: z.string().max(120).nullable().optional(),
  widthM: z.number().positive().max(10).optional(),
  yieldMPerKg: z.number().positive().max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const r = await db.fabric.updateMany({
      where: { id, companyId: user.companyId },
      data: parsed.data,
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const r = await db.fabric.deleteMany({ where: { id, companyId: user.companyId } });
    if (r.count === 0) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}
