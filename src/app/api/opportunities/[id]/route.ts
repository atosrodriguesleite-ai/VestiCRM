import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { reverseAndDeleteOrder } from "@/lib/order-actions";

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

      // Ganhar a oportunidade no funil NÃO gera faturamento: venda só existe
      // com pagamento (pedido pago). Isso evita contar o mesmo dinheiro duas
      // vezes (o pedido do catálogo já cria pedido + oportunidade). A "última
      // compra" também é atualizada apenas quando o pedido é pago.
    }

    const updated = await db.opportunity.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

/**
 * Excluir uma oportunidade do funil — usado para limpar testes.
 * Se houver um pedido criado junto com ela (catálogo), esse pedido também
 * é apagado, desfazendo todo o efeito (estoque + faturamento). Permitido
 * apenas para dono/admin/gerente.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json(
        { error: "Você não tem permissão para excluir oportunidades." },
        { status: 403 }
      );
    }
    const { id } = await params;
    const opp = await db.opportunity.findFirst({
      where: { id, companyId: user.companyId },
      include: { order: { include: { items: true } } },
    });
    if (!opp) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    await db.$transaction(async (tx) => {
      // Pedido gerado junto (catálogo) é desfeito e apagado primeiro.
      if (opp.order) {
        await reverseAndDeleteOrder(tx, opp.order);
      }
      // A oportunidade sai do funil; tarefas/vendas ficam sem vínculo (SetNull).
      await tx.opportunity.delete({ where: { id: opp.id } });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
