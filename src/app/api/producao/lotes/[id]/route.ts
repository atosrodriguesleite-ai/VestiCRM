import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { lancaNoEstoque } from "@/lib/producao-estoque";

/**
 * Ações do lote:
 *  • volta   → registra o retorno (parcial ou total) por item: BOAS entram
 *    no estoque real na hora; DEFEITOS vão pro estoque de defeitos
 *  • fechar  → encerra o lote; o que não voltou fica como FALTANTE na conta
 *    da facção (alimenta o ranking)
 *  • editar  → ajusta o controle do lote: datas de envio/recebimento,
 *    responsáveis, prazo de devolução, custo por peça de cada modelo e o
 *    pagamento da facção (previsão, pago, valor). NÃO mexe em peças nem em
 *    estoque — quantidade só muda por "volta".
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
  z.object({
    action: z.literal("editar"),
    sentAt: z.string().datetime().nullable().optional(),
    closedAt: z.string().datetime().nullable().optional(),
    sentBy: z.string().max(80).nullable().optional(),
    receivedBy: z.string().max(80).nullable().optional(),
    dueBackDate: z.string().datetime().nullable().optional(),
    factionId: z.string().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    // pagamento
    paymentStatus: z.enum(["PENDENTE", "PAGO"]).optional(),
    dueDate: z.string().datetime().nullable().optional(),
    paidAt: z.string().datetime().nullable().optional(),
    paidAmount: z.number().nonnegative().max(10000000).nullable().optional(),
    paymentNotes: z.string().max(300).nullable().optional(),
    // custo por peça de cada modelo do lote
    precos: z
      .array(
        z.object({
          itemId: z.string().min(1),
          pricePerPiece: z.number().nonnegative().max(100000),
        })
      )
      .max(60)
      .optional(),
  }),
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
    const a = parsed.data;
    if (batch.status === "FECHADO" && a.action !== "editar") {
      return NextResponse.json({ error: "Lote já fechado" }, { status: 409 });
    }
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
        data: {
          status,
          // quem conferiu a volta (mantém o primeiro que registrou)
          ...(batch.receivedBy ? {} : { receivedBy: user.name }),
          ...(status === "FECHADO" ? { closedAt: new Date() } : {}),
        },
      });
      return NextResponse.json({ ok: true, status, destinos, avisos, pendentes });
    }

    if (a.action === "editar") {
      // facção só troca em lote de facção e se existir na loja
      let factionId = batch.factionId;
      if (a.factionId !== undefined && batch.destination === "FACCAO") {
        if (a.factionId) {
          const f = await db.sewingFaction.findFirst({
            where: { id: a.factionId, companyId: user.companyId },
            select: { id: true },
          });
          if (!f)
            return NextResponse.json({ error: "Facção não encontrada" }, { status: 404 });
          factionId = f.id;
        } else {
          factionId = null;
        }
      }

      const data: Record<string, unknown> = {};
      if (a.sentAt !== undefined && a.sentAt) data.sentAt = new Date(a.sentAt);
      if (a.closedAt !== undefined)
        data.closedAt = a.closedAt ? new Date(a.closedAt) : null;
      if (a.sentBy !== undefined) data.sentBy = a.sentBy?.trim() || null;
      if (a.receivedBy !== undefined) data.receivedBy = a.receivedBy?.trim() || null;
      if (a.dueBackDate !== undefined)
        data.dueBackDate = a.dueBackDate ? new Date(a.dueBackDate) : null;
      if (a.notes !== undefined) data.notes = a.notes?.trim() || null;
      if (a.factionId !== undefined) data.factionId = factionId;
      if (a.paymentStatus !== undefined) {
        data.paymentStatus = a.paymentStatus;
        // marcou como pago sem dizer quando? assume hoje
        if (a.paymentStatus === "PAGO" && a.paidAt === undefined && !batch.paidAt)
          data.paidAt = new Date();
        if (a.paymentStatus === "PENDENTE" && a.paidAt === undefined) data.paidAt = null;
      }
      if (a.dueDate !== undefined) data.dueDate = a.dueDate ? new Date(a.dueDate) : null;
      if (a.paidAt !== undefined) data.paidAt = a.paidAt ? new Date(a.paidAt) : null;
      if (a.paidAmount !== undefined) data.paidAmount = a.paidAmount;
      if (a.paymentNotes !== undefined)
        data.paymentNotes = a.paymentNotes?.trim() || null;

      if (Object.keys(data).length > 0)
        await db.sewingBatch.update({ where: { id: batch.id }, data });

      // custo por peça de cada modelo (preço histórico deste lote)
      for (const p of a.precos ?? []) {
        const item = batch.items.find((i) => i.id === p.itemId);
        if (!item)
          return NextResponse.json({ error: "Item não pertence ao lote" }, { status: 404 });
        await db.sewingBatchItem.update({
          where: { id: item.id },
          data: { pricePerPiece: p.pricePerPiece },
        });
      }
      return NextResponse.json({ ok: true });
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
