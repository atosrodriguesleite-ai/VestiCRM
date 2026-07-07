import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  brand: z.string().nullable().optional(),
  collection: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  costPrice: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  retailPrice: z.number().nonnegative().optional(),
  minQuantity: z.number().int().positive().optional(),
  tags: z.string().nullable().optional(),
  active: z.boolean().optional(),
  imageUrl: z.string().min(1).optional(), // troca a foto principal
  variantStocks: z
    .array(z.object({ id: z.string().min(1), stock: z.number().int().nonnegative() }))
    .optional(),
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

    const product = await db.product.findFirst({
      where: { id, companyId: user.companyId },
      include: { variants: true, images: { orderBy: { order: "asc" } } },
    });
    if (!product) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }

    const { imageUrl, variantStocks, ...data } = parsed.data;

    // troca da foto principal
    if (imageUrl) {
      const first = product.images[0];
      if (first) {
        await db.productImage.update({
          where: { id: first.id },
          data: { url: imageUrl },
        });
      } else {
        await db.productImage.create({
          data: { productId: product.id, url: imageUrl, order: 0 },
        });
      }
    }

    // ajuste de estoque por variação → gera movimento auditável
    if (variantStocks?.length) {
      for (const vs of variantStocks) {
        const variant = product.variants.find((v) => v.id === vs.id);
        if (!variant || variant.stock === vs.stock) continue;
        await db.productVariant.update({
          where: { id: variant.id },
          data: { stock: vs.stock },
        });
        await db.inventoryMovement.create({
          data: {
            companyId: user.companyId,
            variantId: variant.id,
            type: "AJUSTE",
            quantity: Math.abs(vs.stock - variant.stock),
            reason: `Ajuste manual por ${user.name} (${variant.stock} → ${vs.stock})`,
          },
        });
      }
    }

    const updated = await db.product.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
