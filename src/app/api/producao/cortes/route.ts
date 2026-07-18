import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { calcularEnfesto } from "@/lib/producao";

/**
 * Criação do corte: reserva o peso no rolo (o material "sai" do rolo na hora
 * em que é destinado à mesa) e calcula o enfesto planejado. Código sequencial
 * por loja (#000001, #000002...).
 */

const schema = z.object({
  rollId: z.string().min(1),
  plannedKg: z.number().positive().max(10000),
  date: z.string().optional(),
  operator: z.string().max(80).nullable().optional(),
  tableName: z.string().max(80).nullable().optional(),
  tableLengthM: z.number().positive().max(100).nullable().optional(),
  planName: z.string().max(120).nullable().optional(),
  productName: z.string().max(120).nullable().optional(),
  gradeInfo: z.string().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;

    const roll = await db.fabricRoll.findFirst({
      where: { id: d.rollId, fabric: { companyId: user.companyId } },
      include: { fabric: true },
    });
    if (!roll) {
      return NextResponse.json({ error: "Rolo não encontrado" }, { status: 404 });
    }
    if (d.plannedKg > roll.remainingKg + 0.001) {
      return NextResponse.json(
        { error: `O rolo tem só ${roll.remainingKg.toFixed(2)} kg disponíveis` },
        { status: 409 }
      );
    }

    const enfesto = calcularEnfesto({
      usedKg: d.plannedKg,
      yieldMPerKg: roll.fabric.yieldMPerKg,
      tableLengthM: d.tableLengthM,
    });

    const last = await db.cutTicket.findFirst({
      where: { companyId: user.companyId },
      orderBy: { code: "desc" },
      select: { code: true },
    });

    const cut = await db.$transaction(async (tx) => {
      await tx.fabricRoll.update({
        where: { id: roll.id },
        data: { remainingKg: { decrement: d.plannedKg } },
      });
      return tx.cutTicket.create({
        data: {
          companyId: user.companyId,
          code: (last?.code ?? 0) + 1,
          date: d.date ? new Date(d.date) : new Date(),
          operator: d.operator ?? null,
          tableName: d.tableName ?? null,
          tableLengthM: d.tableLengthM ?? null,
          rollId: roll.id,
          plannedKg: d.plannedKg,
          planName: d.planName ?? null,
          productName: d.productName ?? null,
          gradeInfo: d.gradeInfo ?? null,
          lengthM: enfesto.lengthM,
          sheets: enfesto.sheets,
          notes: d.notes ?? null,
        },
      });
    });

    return NextResponse.json(cut, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
