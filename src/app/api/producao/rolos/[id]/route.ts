import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";

/**
 * Correção de rolo já cadastrado (digitou errado a cor, o peso, o preço).
 *
 * Regra do saldo: o que já foi destinado a cortes é INTOCÁVEL. Ao corrigir
 * o peso comprado, o saldo é recalculado como `peso novo − já usado` — e a
 * correção é recusada se o peso novo for menor do que já saiu do rolo.
 *
 * Preço: cortes FECHADOS guardam o custo do tecido no próprio corte, então
 * corrigir o preço aqui não reescreve o histórico — vale para os próximos.
 */

const schema = z.object({
  color: z.string().min(1).max(60).optional(),
  lotCode: z.string().max(60).nullable().optional(),
  weightKg: z.number().positive().max(10000).optional(),
  pricePerKg: z.number().nonnegative().max(100000).optional(),
  notes: z.string().max(500).nullable().optional(),
});

/** Carrega o rolo garantindo que ele é da loja (multi-tenant). */
async function rolodaLoja(id: string, companyId: string) {
  return db.fabricRoll.findFirst({
    where: { id, fabric: { companyId } },
    include: { cutRolls: { select: { plannedKg: true } } },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const roll = await rolodaLoja(id, user.companyId);
    if (!roll) {
      return NextResponse.json({ error: "Rolo não encontrado" }, { status: 404 });
    }

    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.color !== undefined) data.color = d.color.trim();
    if (d.lotCode !== undefined) data.lotCode = d.lotCode?.trim() || null;
    if (d.pricePerKg !== undefined) data.pricePerKg = d.pricePerKg;
    if (d.notes !== undefined) data.notes = d.notes?.trim() || null;

    if (d.weightKg !== undefined && d.weightKg !== roll.weightKg) {
      // quanto já saiu do rolo (reservado/consumido pelos cortes)
      const usado = Math.round((roll.weightKg - roll.remainingKg) * 1000) / 1000;
      if (d.weightKg < usado) {
        return NextResponse.json(
          {
            error: `Este rolo já teve ${usado.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg destinados a cortes — o peso não pode ficar menor que isso.`,
          },
          { status: 409 }
        );
      }
      data.weightKg = d.weightKg;
      data.remainingKg = Math.round((d.weightKg - usado) * 1000) / 1000;
    }

    if (Object.keys(data).length === 0) return NextResponse.json({ ok: true });

    const atualizado = await db.fabricRoll.update({ where: { id: roll.id }, data });
    return NextResponse.json(atualizado);
  } catch (e) {
    return producaoErro(e);
  }
}

/** Apaga o rolo — só enquanto ele nunca foi usado em corte. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const roll = await rolodaLoja(id, user.companyId);
    if (!roll) {
      return NextResponse.json({ error: "Rolo não encontrado" }, { status: 404 });
    }
    if (roll.cutRolls.length > 0) {
      return NextResponse.json(
        {
          error: `Este rolo já foi usado em ${roll.cutRolls.length} corte(s) — não dá pra apagar sem furar o histórico. Corrija os dados dele.`,
        },
        { status: 409 }
      );
    }
    await db.fabricRoll.delete({ where: { id: roll.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return producaoErro(e);
  }
}
