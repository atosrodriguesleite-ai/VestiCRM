import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { norm } from "@/lib/nuvemshop";

/**
 * Montar LOTE de costura (romaneio): tira peças do estoque de costura
 * (FIFO entre os cortes do SKU) e envia pra costura interna ou pra facção.
 * Lote de CONSERTO consome do estoque de defeitos.
 */

const schema = z.object({
  destination: z.enum(["INTERNA", "FACCAO"]),
  factionId: z.string().nullable().optional(),
  kind: z.enum(["COSTURA", "CONSERTO"]).default("COSTURA"),
  notes: z.string().max(500).nullable().optional(),
  sentAt: z.string().datetime().nullable().optional(), // data do envio (editável já no montar)
  sentBy: z.string().max(80).nullable().optional(), // quem levou/entregou
  dueBackDate: z.string().datetime().nullable().optional(), // prazo combinado de volta
  dueDate: z.string().datetime().nullable().optional(), // previsão de pagamento
  items: z
    .array(
      z.object({
        productName: z.string().min(1).max(120),
        color: z.string().max(60).nullable().optional(),
        size: z.string().max(30).nullable().optional(),
        pieces: z.number().int().positive().max(1000000),
        // custo de costura por peça DESTE modelo; vazio = usa o da facção
        pricePerPiece: z.number().nonnegative().max(100000).nullable().optional(),
      })
    )
    .min(1)
    .max(60),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;

    let faccao: { pricePerPiece: number } | null = null;
    if (d.destination === "FACCAO") {
      const f = d.factionId
        ? await db.sewingFaction.findFirst({
            where: { id: d.factionId, companyId: user.companyId },
          })
        : null;
      if (!f) {
        return NextResponse.json({ error: "Facção não encontrada" }, { status: 404 });
      }
      faccao = f;
    }

    // valida disponibilidade e consome a fonte (costura ou defeitos) FIFO
    if (d.kind === "COSTURA") {
      const pool = await db.sewingItem.findMany({
        where: { companyId: user.companyId },
        orderBy: { createdAt: "asc" },
      });
      for (const it of d.items) {
        const lotes = pool.filter(
          (i) =>
            norm(i.productName) === norm(it.productName) &&
            norm(i.color) === norm(it.color ?? "") &&
            norm(i.size) === norm(it.size ?? "") &&
            i.cutPieces - i.donePieces > 0
        );
        const disp = lotes.reduce((a, i) => a + (i.cutPieces - i.donePieces), 0);
        if (it.pieces > disp) {
          return NextResponse.json(
            {
              error: `${it.productName}${it.color ? ` ${it.color}` : ""}${it.size ? ` ${it.size}` : ""}: só ${disp} peça(s) na costura`,
            },
            { status: 409 }
          );
        }
      }
      // consome FIFO (as peças saem do pool: agora estão NO lote)
      for (const it of d.items) {
        let faltam = it.pieces;
        for (const lote of pool) {
          if (faltam <= 0) break;
          if (
            norm(lote.productName) !== norm(it.productName) ||
            norm(lote.color) !== norm(it.color ?? "") ||
            norm(lote.size) !== norm(it.size ?? "")
          )
            continue;
          const disp = lote.cutPieces - lote.donePieces;
          if (disp <= 0) continue;
          const daqui = Math.min(faltam, disp);
          await db.sewingItem.update({
            where: { id: lote.id },
            data: { donePieces: { increment: daqui } },
          });
          lote.donePieces += daqui;
          faltam -= daqui;
        }
      }
    } else {
      // CONSERTO: consome peças AGUARDANDO do estoque de defeitos
      const defeitos = await db.defectItem.findMany({
        where: { companyId: user.companyId, status: "AGUARDANDO" },
        orderBy: { createdAt: "asc" },
      });
      for (const it of d.items) {
        const disp = defeitos
          .filter(
            (x) =>
              norm(x.productName) === norm(it.productName) &&
              norm(x.color) === norm(it.color ?? "") &&
              norm(x.size) === norm(it.size ?? "")
          )
          .reduce((a, x) => a + x.pieces, 0);
        if (it.pieces > disp) {
          return NextResponse.json(
            { error: `${it.productName}: só ${disp} peça(s) com defeito aguardando` },
            { status: 409 }
          );
        }
      }
      for (const it of d.items) {
        let faltam = it.pieces;
        for (const x of defeitos) {
          if (faltam <= 0) break;
          if (
            norm(x.productName) !== norm(it.productName) ||
            norm(x.color) !== norm(it.color ?? "") ||
            norm(x.size) !== norm(it.size ?? "") ||
            x.status !== "AGUARDANDO" ||
            x.pieces <= 0
          )
            continue;
          const daqui = Math.min(faltam, x.pieces);
          if (daqui === x.pieces) {
            await db.defectItem.update({
              where: { id: x.id },
              data: { status: "EM_CONSERTO" },
            });
            x.status = "EM_CONSERTO";
          } else {
            // divide: parte segue aguardando, parte vai pro conserto
            await db.defectItem.update({
              where: { id: x.id },
              data: { pieces: x.pieces - daqui },
            });
            await db.defectItem.create({
              data: {
                companyId: user.companyId,
                batchId: x.batchId,
                productName: x.productName,
                color: x.color,
                size: x.size,
                pieces: daqui,
                status: "EM_CONSERTO",
              },
            });
            x.pieces -= daqui;
          }
          faltam -= daqui;
        }
      }
    }

    const last = await db.sewingBatch.findFirst({
      where: { companyId: user.companyId },
      orderBy: { code: "desc" },
      select: { code: true },
    });
    const batch = await db.sewingBatch.create({
      data: {
        companyId: user.companyId,
        code: (last?.code ?? 0) + 1,
        kind: d.kind,
        destination: d.destination,
        factionId: d.destination === "FACCAO" ? d.factionId : null,
        notes: d.notes ?? null,
        ...(d.sentAt ? { sentAt: new Date(d.sentAt) } : {}),
        sentBy: d.sentBy?.trim() || user.name,
        dueBackDate: d.dueBackDate ? new Date(d.dueBackDate) : null,
        dueDate: d.dueDate ? new Date(d.dueDate) : null,
        items: {
          create: d.items.map((it) => ({
            productName: it.productName,
            color: it.color ?? null,
            size: it.size ?? null,
            sent: it.pieces,
            // congela o custo por peça: reajuste futuro da facção não
            // reescreve o que este lote custou
            pricePerPiece:
              it.pricePerPiece != null && it.pricePerPiece >= 0
                ? it.pricePerPiece
                : (faccao?.pricePerPiece ?? 0),
          })),
        },
      },
      include: { items: true },
    });
    return NextResponse.json(batch, { status: 201 });
  } catch (e) {
    return producaoErro(e);
  }
}
