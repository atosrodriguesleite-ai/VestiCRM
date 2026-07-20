import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp, isSupport } from "@/lib/scope";

/**
 * Tabela de SKUs: preencher o SKU de TODOS os produtos e de cada variação
 * (cor × tamanho) num lugar só — é a chave universal do vínculo com a
 * Nuvemshop e outras integrações.
 */

export async function GET() {
  try {
    const user = await requireUser();
    if (!isManagerUp(user) && !isSupport(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const products = await db.product.findMany({
      where: { companyId: user.companyId },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        variants: {
          select: { id: true, color: true, size: true, sku: true },
          orderBy: [{ color: "asc" }, { size: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ products });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const postSchema = z.object({
  products: z
    .array(z.object({ id: z.string().min(1), sku: z.string().max(60) }))
    .max(2000)
    .default([]),
  variants: z
    .array(z.object({ id: z.string().min(1), sku: z.string().max(60).nullable() }))
    .max(10000)
    .default([]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user) && !isSupport(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    let salvos = 0;
    for (const p of parsed.data.products) {
      const r = await db.product.updateMany({
        where: { id: p.id, companyId: user.companyId },
        data: { sku: p.sku.trim() },
      });
      salvos += r.count;
    }
    for (const v of parsed.data.variants) {
      const r = await db.productVariant.updateMany({
        where: { id: v.id, product: { companyId: user.companyId } },
        data: { sku: v.sku?.trim() || null },
      });
      salvos += r.count;
    }
    return NextResponse.json({ ok: true, salvos });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
