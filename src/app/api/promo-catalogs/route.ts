import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/** Catálogos de campanha: vitrine à parte com produtos escolhidos + desconto. */

const createSchema = z.object({
  name: z.string().min(2).max(60),
  discount: z.number().int().min(1).max(90),
  productIds: z.array(z.string().min(1)).min(1).max(500),
});

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function GET() {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const list = await db.promoCatalog.findMany({
      where: { companyId: user.companyId },
      include: { _count: { select: { products: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(
      list.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        discount: p.discount,
        active: p.active,
        products: p._count.products,
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
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const { name, discount, productIds } = parsed.data;

    // só produtos da própria loja entram
    const owned = await db.product.findMany({
      where: { id: { in: productIds }, companyId: user.companyId },
      select: { id: true },
    });
    if (owned.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos um produto." }, { status: 400 });
    }

    // slug único por loja (colisão ganha sufixo numérico)
    const base = slugify(name) || "campanha";
    let slug = base;
    for (let n = 2; n < 50; n++) {
      const taken = await db.promoCatalog.findUnique({
        where: { companyId_slug: { companyId: user.companyId, slug } },
      });
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    const promo = await db.promoCatalog.create({
      data: {
        companyId: user.companyId,
        name,
        slug,
        discount,
        products: { create: owned.map((p) => ({ productId: p.id })) },
      },
      include: { _count: { select: { products: true } } },
    });
    return NextResponse.json(
      {
        id: promo.id,
        name: promo.name,
        slug: promo.slug,
        discount: promo.discount,
        active: promo.active,
        products: promo._count.products,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
