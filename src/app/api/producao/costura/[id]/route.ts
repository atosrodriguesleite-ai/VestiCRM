import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProducao, producaoErro } from "@/lib/producao-auth";
import { norm, baseNome, corDoNome } from "@/lib/nuvemshop";
import { pushStockToNuvemshop } from "@/lib/nuvemshop";

/**
 * Lançamento da COSTURA: a peça foi montada e conferida → dá ENTRADA no
 * estoque real do catálogo (e a Nuvemshop recebe a atualização sozinha,
 * quando conectada) e baixa do estoque de costura.
 *
 * O casamento com o produto usa as mesmas regras da integração:
 *  • nome exato ("Baby Look" ↔ "Baby Look"), ou
 *  • família produto-por-cor ("Baby Look" + cor Preto ↔ "Baby Look — Preto")
 *  • variação por cor + tamanho (sem pegadinha de acento/caixa)
 * Sem par no catálogo, a baixa da costura acontece e o aviso orienta o
 * lançamento manual em Produtos.
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireProducao();
    const { id } = await params;
    const parsed = z
      .object({ pieces: z.number().int().positive().max(1000000) })
      .safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const item = await db.sewingItem.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!item) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    const restantes = item.cutPieces - item.donePieces;
    if (parsed.data.pieces > restantes) {
      return NextResponse.json(
        { error: `Só restam ${restantes} peça(s) na costura deste corte` },
        { status: 409 }
      );
    }

    // procura a variação correspondente no catálogo
    const produtos = await db.product.findMany({
      where: { companyId: user.companyId },
      include: { variants: true },
    });
    let alvo: { productName: string; variantId: string; color: string; size: string } | null =
      null;
    for (const p of produtos) {
      const sufixo = corDoNome(p.name);
      const casaProduto = sufixo
        ? norm(baseNome(p.name)) === norm(item.productName) &&
          (!item.color || norm(sufixo) === norm(item.color))
        : norm(p.name) === norm(item.productName);
      if (!casaProduto) continue;
      const v = p.variants.find(
        (x) =>
          (!item.color || norm(x.color) === norm(item.color)) &&
          (!item.size || norm(x.size) === norm(item.size))
      );
      if (v) {
        alvo = { productName: p.name, variantId: v.id, color: v.color, size: v.size };
        break;
      }
    }

    await db.sewingItem.update({
      where: { id: item.id },
      data: { donePieces: { increment: parsed.data.pieces } },
    });

    if (alvo) {
      await db.productVariant.update({
        where: { id: alvo.variantId },
        data: { stock: { increment: parsed.data.pieces } },
      });
      await db.inventoryMovement.create({
        data: {
          companyId: user.companyId,
          variantId: alvo.variantId,
          type: "ENTRADA",
          quantity: parsed.data.pieces,
          reason: `Costura finalizada por ${user.name}${item.cutCode ? ` (corte #${String(item.cutCode).padStart(6, "0")})` : ""}`,
        },
      });
      // loja online conectada recebe o estoque novo sozinha
      pushStockToNuvemshop(user.companyId, [alvo.variantId]).catch(() => {});
      return NextResponse.json({
        ok: true,
        lancadas: parsed.data.pieces,
        destino: `${alvo.productName} · ${alvo.color} · ${alvo.size}`,
      });
    }

    return NextResponse.json({
      ok: true,
      lancadas: parsed.data.pieces,
      destino: null,
      aviso:
        "Baixei da costura, mas não achei essa peça no catálogo (nome/cor/tamanho). Dê a entrada manual em Produtos — ou ajuste os nomes pra casar sozinho da próxima vez.",
    });
  } catch (e) {
    return producaoErro(e);
  }
}
