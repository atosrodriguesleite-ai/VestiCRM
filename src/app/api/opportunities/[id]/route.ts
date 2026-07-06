import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const patchSchema = z.object({
  stageId: z.string().optional(),
  lostReason: z.string().optional(),
  value: z.number().nonnegative().optional(),
  title: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }

    const opp = await db.opportunity.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!opp) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const data: Record<string, unknown> = {
      lastInteractionAt: new Date(),
    };
    if (parsed.data.title) data.title = parsed.data.title;
    if (parsed.data.value !== undefined) data.value = parsed.data.value;
    if (parsed.data.lostReason !== undefined)
      data.lostReason = parsed.data.lostReason;

    if (parsed.data.stageId) {
      const stage = await db.stage.findFirst({
        where: {
          id: parsed.data.stageId,
          pipeline: { companyId: user.companyId },
        },
      });
      if (!stage) {
        return NextResponse.json({ error: "Etapa inválida" }, { status: 404 });
      }
      data.stageId = stage.id;
      data.status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";
      data.closedAt = stage.isWon || stage.isLost ? new Date() : null;

      // pedido fechado → registra venda + atualiza última compra do cliente
      if (stage.isWon && opp.status !== "WON") {
        await db.sale.create({
          data: {
            companyId: user.companyId,
            customerId: opp.customerId,
            opportunityId: opp.id,
            sellerId: opp.ownerId,
            total: opp.value,
            description: opp.title,
          },
        });
        await db.customer.update({
          where: { id: opp.customerId },
          data: { lastPurchaseAt: new Date() },
        });
      }
    }

    const updated = await db.opportunity.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
