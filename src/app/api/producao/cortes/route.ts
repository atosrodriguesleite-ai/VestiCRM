import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { calcularEnfestoRolos } from "@/lib/producao";

/**
 * Criação do corte MULTI-ROLO: o corte sempre pode ter vários rolos (várias
 * cores enfestadas juntas), cada um com seu peso. Reserva o peso em cada
 * rolo na criação e calcula o enfesto somando os metros de todos.
 */

const schema = z.object({
  rolos: z
    .array(
      z.object({
        rollId: z.string().min(1),
        kg: z.number().positive().max(10000),
      })
    )
    .min(1)
    .max(15),
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

    // não aceita o mesmo rolo repetido na lista
    const ids = d.rolos.map((r) => r.rollId);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: "O mesmo rolo aparece duas vezes — some os pesos numa linha só" },
        { status: 400 }
      );
    }

    const rolls = await db.fabricRoll.findMany({
      where: { id: { in: ids }, fabric: { companyId: user.companyId } },
      include: { fabric: true },
    });
    if (rolls.length !== ids.length) {
      return NextResponse.json({ error: "Rolo não encontrado" }, { status: 404 });
    }
    const byId = new Map(rolls.map((r) => [r.id, r]));
    for (const r of d.rolos) {
      const roll = byId.get(r.rollId)!;
      if (r.kg > roll.remainingKg + 0.001) {
        return NextResponse.json(
          {
            error: `O rolo ${roll.fabric.name} — ${roll.color} tem só ${roll.remainingKg.toFixed(2)} kg disponíveis`,
          },
          { status: 409 }
        );
      }
    }

    const plannedKg = Math.round(d.rolos.reduce((a, r) => a + r.kg, 0) * 1000) / 1000;
    const enfesto = calcularEnfestoRolos(
      d.rolos.map((r) => ({ kg: r.kg, yieldMPerKg: byId.get(r.rollId)!.fabric.yieldMPerKg })),
      d.tableLengthM
    );

    const last = await db.cutTicket.findFirst({
      where: { companyId: user.companyId },
      orderBy: { code: "desc" },
      select: { code: true },
    });

    const cut = await db.$transaction(async (tx) => {
      for (const r of d.rolos) {
        await tx.fabricRoll.update({
          where: { id: r.rollId },
          data: { remainingKg: { decrement: r.kg } },
        });
      }
      return tx.cutTicket.create({
        data: {
          companyId: user.companyId,
          code: (last?.code ?? 0) + 1,
          date: d.date ? new Date(d.date) : new Date(),
          operator: d.operator ?? null,
          tableName: d.tableName ?? null,
          tableLengthM: d.tableLengthM ?? null,
          plannedKg,
          planName: d.planName ?? null,
          productName: d.productName ?? null,
          gradeInfo: d.gradeInfo ?? null,
          lengthM: enfesto.lengthM,
          sheets: enfesto.sheets,
          notes: d.notes ?? null,
          rolls: {
            create: d.rolos.map((r) => ({ rollId: r.rollId, plannedKg: r.kg })),
          },
        },
      });
    });

    return NextResponse.json(cut, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
