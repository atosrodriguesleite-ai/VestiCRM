import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * Exporta o catálogo da loja como arquivo de backup (.json) no MESMO formato
 * da importação — ou seja, o backup é restaurável pelo importador (que é
 * aditivo e nunca sobrescreve edições). Inclui produtos, preços, ESTOQUE REAL
 * por cor/tamanho, fotos e identidade do catálogo.
 *
 * Fotos em base64 estouram o limite de resposta do serverless em catálogos
 * grandes; por isso a entrega é em fatias (?desde=<índice>) e o navegador
 * monta o arquivo final único. `proximo` = null encerra.
 */

export const maxDuration = 60;

// orçamento por fatia, folgado sob o limite (~4,5 MB) da resposta
const BUDGET_BYTES = 3 * 1024 * 1024;

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const desde = Math.max(0, parseInt(req.nextUrl.searchParams.get("desde") ?? "0") || 0);

    const ids = await db.product.findMany({
      where: { companyId: user.companyId },
      select: { id: true },
      orderBy: [{ sku: "asc" }, { id: "asc" }],
    });

    // cabeçalho (identidade + bibliotecas) só na primeira fatia
    let cabecalho: Record<string, unknown> | null = null;
    if (desde === 0) {
      const [company, colors, sizes] = await Promise.all([
        db.company.findUnique({ where: { id: user.companyId } }),
        db.companyColor.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
        db.companySize.findMany({ where: { companyId: user.companyId }, orderBy: { order: "asc" } }),
      ]);
      cabecalho = {
        store: company
          ? {
              tagline: company.tagline ?? undefined,
              whatsapp: company.whatsapp ?? undefined,
              logoUrl: company.logoUrl ?? undefined,
              catalogPrimary: company.catalogPrimary,
              catalogSecondary: company.catalogSecondary,
              catalogBg: company.catalogBg,
              catalogFont: company.catalogFont,
              minOrderMode: company.minOrderMode,
              minOrder: company.minOrder,
              minOrderValue: company.minOrderValue,
            }
          : undefined,
        palette: colors.map((c) => ({ name: c.name, hex: c.hex })),
        sizes: sizes.map((s) => s.name),
        slug: (company?.slug ?? "loja") as string,
      };
    }

    const products: Record<string, unknown>[] = [];
    let bytes = 0;
    let i = desde;
    for (; i < ids.length; i++) {
      const p = await db.product.findUnique({
        where: { id: ids[i].id },
        include: {
          variants: { orderBy: [{ color: "asc" }, { size: "asc" }] },
          images: { orderBy: { order: "asc" } },
        },
      });
      if (!p) continue;

      // fotos: data-URLs entram como estão; ATALHOS /api/img/<id> são
      // resolvidos para a foto real (nunca exportamos ponteiro — foi a classe
      // de bug das fotos fantasma); externas/estáticas entram como estão.
      const images: string[] = [];
      for (const img of p.images) {
        const ref = img.url.match(/^\/api\/img\/([a-z0-9]+)/i);
        if (ref) {
          const target = await db.productImage.findUnique({
            where: { id: ref[1] },
            select: { url: true },
          });
          if (target?.url.startsWith("data:")) images.push(target.url);
          continue;
        }
        images.push(img.url);
      }

      const stockByVariant: Record<string, number> = {};
      for (const v of p.variants) stockByVariant[`${v.color}/${v.size}`] = v.stock;

      const item = {
        name: p.name,
        sku: p.sku,
        category: p.category,
        collection: p.collection ?? undefined,
        description: p.description ?? undefined,
        retailPrice: p.retailPrice,
        wholesalePrice: p.wholesalePrice,
        costPrice: p.costPrice,
        minQuantity: p.minQuantity,
        tags: p.tags ?? undefined,
        active: p.active,
        colors: [...new Set(p.variants.map((v) => v.color))],
        sizes: [...new Set(p.variants.map((v) => v.size))],
        stockByVariant,
        images,
      };
      const size = JSON.stringify(item).length;
      if (products.length > 0 && bytes + size > BUDGET_BYTES) break;
      products.push(item);
      bytes += size;
    }

    return NextResponse.json({
      total: ids.length,
      desde,
      proximo: i < ids.length ? i : null,
      ...(cabecalho ? { cabecalho } : {}),
      products,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
