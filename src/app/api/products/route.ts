import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { imageHref } from "@/lib/img";
import { ordenarVariantes } from "@/lib/tamanhos";
import { requireUser, AuthError } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

const variantSchema = z.object({
  color: z.string().min(1),
  size: z.string().min(1),
  stock: z.number().int().nonnegative().default(0),
});

const createSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  category: z.string().min(1),
  brand: z.string().optional(),
  collection: z.string().optional(),
  description: z.string().optional(),
  videoUrl: z.string().optional(),
  costPrice: z.number().nonnegative().default(0),
  wholesalePrice: z.number().nonnegative().default(0),
  retailPrice: z.number().nonnegative().default(0),
  minQuantity: z.number().int().positive().default(1),
  weightGrams: z.number().int().min(1).max(30000).nullable().optional(), // frete
  tags: z.string().optional(),
  active: z.boolean().default(true),
  images: z.array(z.string().min(1)).default([]),
  variants: z.array(variantSchema).min(1),
});

/** Busca de produtos com filtros (usada na página e no picker do WhatsApp). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q") ?? undefined;
    const category = sp.get("categoria") ?? undefined;
    const color = sp.get("cor") ?? undefined;
    const size = sp.get("tamanho") ?? undefined;
    const collection = sp.get("colecao") ?? undefined;
    const brand = sp.get("marca") ?? undefined;
    const maxPrice = sp.get("precoMax") ? Number(sp.get("precoMax")) : undefined;
    const inStock = sp.get("comEstoque") === "1";
    const onlyActive = sp.get("inativos") !== "1";

    const where: Prisma.ProductWhereInput = { companyId: user.companyId };
    if (onlyActive) where.active = true;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ];
    }
    if (category) where.category = category;
    if (collection) where.collection = collection;
    if (brand) where.brand = brand;
    if (maxPrice) where.retailPrice = { lte: maxPrice };
    if (color || size || inStock) {
      where.variants = {
        some: {
          ...(color ? { color } : {}),
          ...(size ? { size } : {}),
          ...(inStock ? { stock: { gt: 0 } } : {}),
        },
      };
    }

    const products = await db.product.findMany({
      where,
      include: {
        variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
        images: { orderBy: { order: "asc" }, select: { id: true, order: true } },
      },
      orderBy: { name: "asc" },
      take: 60,
    });
    // fotos data-URL viram /api/img/<id> — resposta leve para o navegador.
    // A grade sai na ordem de ROUPA (PP, P, M, G, GG / numeração): é o que os
    // seletores de novo pedido / editar itens mostram
    return NextResponse.json(
      products.map((p) => ({
        ...p,
        variants: ordenarVariantes(p.variants),
        images: p.images.map((i) => ({ ...i, url: imageHref(i.id) })),
      }))
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { images, variants, ...data } = parsed.data;

    const exists = await db.product.findFirst({
      where: { companyId: user.companyId, sku: data.sku },
    });
    if (exists) {
      return NextResponse.json(
        { error: "Já existe um produto com este SKU" },
        { status: 409 }
      );
    }

    const product = await db.product.create({
      data: {
        ...data,
        companyId: user.companyId,
        images: { create: images.map((url, i) => ({ url, order: i })) },
        variants: { create: variants },
      },
      include: { variants: true, images: true },
    });

    // estoque inicial registrado como movimento de entrada
    await db.inventoryMovement.createMany({
      data: product.variants
        .filter((v) => v.stock > 0)
        .map((v) => ({
          companyId: user.companyId,
          variantId: v.id,
          type: "ENTRADA" as const,
          quantity: v.stock,
          reason: "Estoque inicial",
        })),
    });

    return NextResponse.json(product, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
