import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { lancaNoEstoque } from "@/lib/producao-estoque";

/**
 * Conferência do lote:
 *  • volta   → registra o retorno (parcial ou total) por item: BOAS entram
 *    no estoque real na hora; DEFEITOS vão pro estoque de defeitos
 *  • fechar  → encerra o lote; o que não voltou fica como FALTANTE na conta
 *    da facção (alimenta o ranking)
 */

const acaoSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("volta"),
    items: z
      .array(
        z.object({
          itemId: z.string().min(1),
          good: z.number().int().nonnegative().max(1000000).default(0),
          defect: z.number().int().nonnegative().max(1000000).default(0),
        })
      )
      .min(1)
      .max(60),
  }),
  z.object({ action: z.literal("fechar") }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = acaoSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const batch = await db.sewingBatch.findFirst({
      where: { id, companyId: user.companyId },
      include: { items: true, faction: true },
    });
    if (!batch) {
      return NextResponse.json({ error: "Lote não encontrado" }, { status: 404 });
    }
    if (batch.status === "FECHADO") {
      return NextResponse.json({ error: "Lote já fechado" }, { status: 409 });
    }
    const a = parsed.data;
    const codigo = `L-${String(batch.code).padStart(6, "0")}`;

    if (a.action === "volta") {
      const destinos: string[] = [];
      const avisos: string[] = [];
      for (const v of a.items) {
        if (v.good + v.defect === 0) continue;
        const item = batch.items.find((i) => i.id === v.itemId);
        if (!item) {
          return NextResponse.json({ error: "Item não pertence ao lote" }, { status: 404 });
        }
        const pendente = item.sent - item.good - item.defect;
        if (v.good + v.defect > pendente) {
          return NextResponse.json(
            {
              error: `${item.productName}${item.size ? ` ${item.size}` : ""}: só ${pendente} peça(s) ainda fora — confira a contagem`,
            },
            { status: 409 }
          );
        }
        await db.sewingBatchItem.update({
          where: { id: item.id },
          data: { good: { increment: v.good }, defect: { increment: v.defect } },
        });
        // boas → estoque real (mesmo casamento do lançamento da costura)
        if (v.good > 0) {
          const destino = await lancaNoEstoque(
            user.companyId,
            user.name,
            { productName: item.productName, color: item.color, size: item.size },
            v.good,
            `Volta do lote ${codigo}${batch.faction ? ` (${batch.faction.name})` : ""}`
          );
          if (destino) destinos.push(`${v.good}× ${destino}`);
          else
            avisos.push(
              `${item.productName}: sem par no catálogo — dê a entrada manual em Produtos`
            );
        }
        // defeitos → estoque de defeitos
        if (v.defect > 0) {
          await db.defectItem.create({
            data: {
              companyId: user.companyId,
              batchId: batch.id,
              productName: item.productName,
              color: item.color,
              size: item.size,
              pieces: v.defect,
            },
          });
        }
      }
      // tudo voltou? fecha sozinho; senão fica PARCIAL
      const atualizado = await db.sewingBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: { items: true },
      });
      const pendentes = atualizado.items.reduce(
        (s, i) => s + (i.sent - i.good - i.defect),
        0
      );
      const status = pendentes === 0 ? "FECHADO" : "PARCIAL";
      await db.sewingBatch.update({
        where: { id: batch.id },
        data: { status, ...(status === "FECHADO" ? { closedAt: new Date() } : {}) },
      });
      return NextResponse.json({ ok: true, status, destinos, avisos, pendentes });
    }

    // fechar: o que não voltou vira faltante (fica na conta da facção)
    const faltantes = batch.items.reduce((s, i) => s + (i.sent - i.good - i.defect), 0);
    await db.sewingBatch.update({
      where: { id: batch.id },
      data: { status: "FECHADO", closedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: "FECHADO", faltantes });
  } catch (e) {
    return producaoErro(e);
  }
}
