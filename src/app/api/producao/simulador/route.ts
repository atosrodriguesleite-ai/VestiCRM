import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { preverPecas, experienciasDe } from "@/lib/producao";

/**
 * Simulador de compra: "se eu comprar X kg desse tecido, quantas peças
 * saem?" — responde com o histórico REAL da fábrica, sem criar nada.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = z
      .object({
        fabricId: z.string().min(1),
        kg: z.number().positive().max(100000),
        productName: z.string().max(120).nullable().optional(),
      })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;
    const fabric = await db.fabric.findFirst({
      where: { id: d.fabricId, companyId: user.companyId },
      include: { rolls: { orderBy: { arrivedAt: "desc" }, take: 1 } },
    });
    if (!fabric) {
      return NextResponse.json({ error: "Tecido não encontrado" }, { status: 404 });
    }

    const fechados = await db.cutTicket.findMany({
      where: { companyId: user.companyId, status: "FECHADO" },
      include: { rolls: { include: { roll: { include: { fabric: true } } } } },
      orderBy: { finalizedAt: "desc" },
      take: 500,
    });
    const proj = preverPecas(
      experienciasDe(fechados),
      {
        fabricId: fabric.id,
        fabricType: fabric.type,
        supplier: fabric.supplier,
        grammage: fabric.grammage,
        productName: d.productName ?? null,
      },
      d.kg
    );

    const precoKg = fabric.rolls[0]?.pricePerKg ?? null;
    return NextResponse.json({
      metros: Math.round(d.kg * fabric.yieldMPerKg * 100) / 100,
      custoTecido: precoKg != null ? Math.round(d.kg * precoKg * 100) / 100 : null,
      projecao: proj, // null = sem histórico parecido ainda
    });
  } catch (e) {
    return producaoErro(e);
  }
}
