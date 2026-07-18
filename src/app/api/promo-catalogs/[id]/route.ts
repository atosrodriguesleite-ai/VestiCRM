import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

const patchSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  discount: z.number().int().min(1).max(90).optional(),
  active: z.boolean().optional(),
  productIds: z.array(z.string().min(1)).min(1).max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const promo = await db.promoCatalog.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!promo) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }

    const { productIds, ...data } = parsed.data;
    if (productIds) {
      const owned = await db.product.findMany({
        where: { id: { in: productIds }, companyId: user.companyId },
        select: { id: true },
      });
      await db.promoCatalogProduct.deleteMany({ where: { promoId: promo.id } });
      await db.promoCatalogProduct.createMany({
        data: owned.map((p) => ({ promoId: promo.id, productId: p.id })),
      });
    }
    const updated = await db.promoCatalog.update({
      where: { id: promo.id },
      data,
      include: { _count: { select: { products: true } } },
    });
    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      discount: updated.discount,
      active: updated.active,
      products: updated._count.products,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    const promo = await db.promoCatalog.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!promo) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    await db.promoCatalog.delete({ where: { id: promo.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
