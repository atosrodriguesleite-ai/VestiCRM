import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { norm, baseNome, corDoNome, pushStockToNuvemshop } from "@/lib/nuvemshop";

/**
 * Lançamento DIÁRIO por SKU: quem repõe o estoque conta as peças prontas
 * de cada SKU (modelo · cor · tamanho) e digita o TOTAL do dia. O sistema:
 *   1. confere quanto daquele SKU existe no estoque de costura;
 *   2. distribui a baixa entre os lotes automaticamente (corte mais antigo
 *      primeiro — FIFO);
 *   3. dá UMA entrada no estoque real do catálogo (auditável) e empurra
 *      pra Nuvemshop quando conectada.
 * Nunca deixa lançar mais do que está cortado.
 */

export async function POST(req: NextRequest) {
  try {
    const user = await requireProducao();
    const parsed = z
      .object({
        productName: z.string().min(1).max(120),
        color: z.string().max(60).nullable().optional(),
        size: z.string().max(30).nullable().optional(),
        pieces: z.number().int().positive().max(1000000),
      })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;

    // lotes do SKU na costura, do corte mais antigo pro mais novo (FIFO)
    const lotes = (
      await db.sewingItem.findMany({
        where: { companyId: user.companyId },
        orderBy: { createdAt: "asc" },
      })
    ).filter(
      (i) =>
        norm(i.productName) === norm(d.productName) &&
        norm(i.color) === norm(d.color ?? "") &&
        norm(i.size) === norm(d.size ?? "") &&
        i.cutPieces - i.donePieces > 0
    );
    const disponivel = lotes.reduce((a, i) => a + (i.cutPieces - i.donePieces), 0);
    if (d.pieces > disponivel) {
      return NextResponse.json(
        {
          error: `Na costura existem ${disponivel} peça(s) desse SKU — confira a contagem ou registre o corte que está faltando.`,
        },
        { status: 409 }
      );
    }

    // entrada única no estoque real (mesmo casamento da integração)
    const produtos = await db.product.findMany({
      where: { companyId: user.companyId },
      include: { variants: true },
    });
    let alvo: { productName: string; variantId: string; color: string; size: string } | null =
      null;
    for (const p of produtos) {
      const sufixo = corDoNome(p.name);
      const casaProduto = sufixo
        ? norm(baseNome(p.name)) === norm(d.productName) &&
          (!d.color || norm(sufixo) === norm(d.color))
        : norm(p.name) === norm(d.productName);
      if (!casaProduto) continue;
      const v = p.variants.find(
        (x) =>
          (!d.color || norm(x.color) === norm(d.color)) &&
          (!d.size || norm(x.size) === norm(d.size))
      );
      if (v) {
        alvo = { productName: p.name, variantId: v.id, color: v.color, size: v.size };
        break;
      }
    }

    // baixa da costura + crédito no estoque NUMA TRANSAÇÃO SÓ: uma falha no
    // meio deixava a peça baixada da costura sem entrar no estoque — sumia
    // entre os dois mundos (auditoria 07/08/2026)
    const cortesUsados: number[] = [];
    await db.$transaction(
      async (tx) => {
        // distribui a baixa entre os lotes (FIFO)
        let faltam = d.pieces;
        for (const lote of lotes) {
          if (faltam <= 0) break;
          const daqui = Math.min(faltam, lote.cutPieces - lote.donePieces);
          await tx.sewingItem.update({
            where: { id: lote.id },
            data: { donePieces: { increment: daqui } },
          });
          if (lote.cutCode != null && !cortesUsados.includes(lote.cutCode)) {
            cortesUsados.push(lote.cutCode);
          }
          faltam -= daqui;
        }
        if (alvo) {
          const cortesLabel = cortesUsados
            .map((c) => `#${String(c).padStart(6, "0")}`)
            .join(", ");
          await tx.productVariant.update({
            where: { id: alvo.variantId },
            data: { stock: { increment: d.pieces } },
          });
          await tx.inventoryMovement.create({
            data: {
              companyId: user.companyId,
              variantId: alvo.variantId,
              type: "ENTRADA",
              quantity: d.pieces,
              reason: `Costura finalizada por ${user.name}${cortesLabel ? ` (corte${cortesUsados.length > 1 ? "s" : ""} ${cortesLabel})` : ""}`,
            },
          });
        }
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

    if (alvo) {
      pushStockToNuvemshop(user.companyId, [alvo.variantId]).catch(() => {});
      return NextResponse.json({
        ok: true,
        lancadas: d.pieces,
        destino: `${alvo.productName} · ${alvo.color} · ${alvo.size}`,
        cortes: cortesUsados,
        restamNaCostura: disponivel - d.pieces,
      });
    }

    return NextResponse.json({
      ok: true,
      lancadas: d.pieces,
      destino: null,
      cortes: cortesUsados,
      restamNaCostura: disponivel - d.pieces,
      aviso:
        "Baixei da costura, mas não achei essa peça no catálogo (nome/cor/tamanho). Dê a entrada manual em Produtos — ou ajuste os nomes pra casar sozinho da próxima vez.",
    });
  } catch (e) {
    return producaoErro(e);
  }
}
