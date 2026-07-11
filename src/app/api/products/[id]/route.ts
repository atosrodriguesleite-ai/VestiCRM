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
  // gestão da grade: adicionar novas combinações cor × tamanho e remover
  addVariants: z
    .array(
      z.object({
        color: z.string().min(1),
        size: z.string().min(1),
        stock: z.number().int().nonnegative().default(0),
      })
    )
    .optional(),
  removeVariantIds: z.array(z.string()).optional(),
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

    const { imageUrl, variantStocks, addVariants, removeVariantIds, ...data } =
      parsed.data;

    // troca da foto principal — apaga e recria para nascer com id NOVO:
    // /api/img/<id> usa cache imutável, então foto nova precisa de URL nova
    if (imageUrl) {
      const first = product.images[0];
      if (first) {
        await db.productImage.delete({ where: { id: first.id } });
      }
      await db.productImage.create({
        data: { productId: product.id, url: imageUrl, order: 0 },
      });
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

    // novas combinações da grade
    if (addVariants?.length) {
      for (const v of addVariants) {
        const created = await db.productVariant.upsert({
          where: {
            productId_color_size: {
              productId: product.id,
              color: v.color.trim(),
              size: v.size.trim(),
            },
          },
          update: {},
          create: {
            productId: product.id,
            color: v.color.trim(),
            size: v.size.trim(),
            stock: v.stock,
          },
        });
        if (v.stock > 0) {
          await db.inventoryMovement.create({
            data: {
              companyId: user.companyId,
              variantId: created.id,
              type: "ENTRADA",
              quantity: v.stock,
              reason: `Nova variação por ${user.name}`,
            },
          });
        }
      }
    }

    // remoção de variações da grade
    if (removeVariantIds?.length) {
      await db.productVariant.deleteMany({
        where: { id: { in: removeVariantIds }, productId: product.id },
      });
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

/** Remove o produto do catálogo (itens de pedidos antigos ficam preservados). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const product = await db.product.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!product) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    }
    await db.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
