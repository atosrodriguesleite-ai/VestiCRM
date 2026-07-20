import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isSupport } from "@/lib/scope";
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
  imageUrl: z.string().min(1).optional(), // legado: troca a foto única
  // galeria completa em ordem (a primeira é a CAPA): itens com `id` são fotos
  // que já existem (mantidas), itens com `url` são fotos novas (data-URL)
  images: z
    .array(
      z
        .object({ id: z.string().optional(), url: z.string().optional() })
        .refine((e) => e.id || e.url)
    )
    .max(10)
    .optional(),
  variantStocks: z
    .array(
      z.object({
        id: z.string().min(1),
        stock: z.number().int().nonnegative(),
        sku: z.string().max(60).nullable().optional(),
      })
    )
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
    if (isSupport(user)) {
      return NextResponse.json(
        { error: "Alterar produtos é permitido só para gerente ou admin." },
        { status: 403 }
      );
    }
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

    const {
      imageUrl,
      images: imageList,
      variantStocks,
      addVariants,
      removeVariantIds,
      ...data
    } = parsed.data;

    // galeria completa: a lista enviada É o estado final, na ordem final
    // (posição 0 = capa). Fotos existentes chegam por id e só têm a ordem
    // atualizada — o conteúdo não muda, então o cache imutável de
    // /api/img/<id> continua válido. Fotos fora da lista são removidas.
    if (imageList) {
      const keepIds = imageList.flatMap((e) => (e.id ? [e.id] : []));
      await db.productImage.deleteMany({
        where: { productId: product.id, id: { notIn: keepIds } },
      });
      for (let i = 0; i < imageList.length; i++) {
        const e = imageList[i];
        if (e.id) {
          await db.productImage.updateMany({
            where: { id: e.id, productId: product.id },
            data: { order: i },
          });
        } else if (e.url) {
          await db.productImage.create({
            data: { productId: product.id, url: e.url, order: i },
          });
        }
      }
    } else if (imageUrl) {
      // legado: troca da foto principal — apaga e recria para nascer com id
      // NOVO (/api/img/<id> usa cache imutável; foto nova pede URL nova)
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
        if (!variant) continue;
        // SKU da variação (vínculo com a loja online) — atualiza se mudou
        if (vs.sku !== undefined && (vs.sku ?? null) !== variant.sku) {
          await db.productVariant.update({
            where: { id: variant.id },
            data: { sku: vs.sku },
          });
        }
        if (variant.stock === vs.stock) continue;
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
    if (isSupport(user)) {
      return NextResponse.json(
        { error: "Alterar produtos é permitido só para gerente ou admin." },
        { status: 403 }
      );
    }
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
