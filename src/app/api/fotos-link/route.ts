import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { criarLinkDeFotos, normalizarCategorias, urlDoLinkDeFotos } from "@/lib/fotos/link";

/**
 * RN-071 · Link de fotos para a cliente.
 *  GET  → as categorias da loja com quantas peças têm foto (e quantas com
 *         estoque), para a janelinha da Central montar as caixinhas.
 *  POST → gera o link (código sorteado, 7 dias) e devolve a URL pública.
 */

export async function GET() {
  try {
    const user = await requireUser();
    const produtos = await db.product.findMany({
      where: { companyId: user.companyId, active: true, images: { some: {} } },
      select: { category: true, variants: { select: { stock: true } } },
    });
    const porCategoria = new Map<string, { pecas: number; comEstoque: number }>();
    for (const p of produtos) {
      const cat = p.category.trim() || "Outros";
      const atual = porCategoria.get(cat) ?? { pecas: 0, comEstoque: 0 };
      atual.pecas += 1;
      if (p.variants.some((v) => v.stock > 0)) atual.comEstoque += 1;
      porCategoria.set(cat, atual);
    }
    const comparar = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare;
    const categorias = [...porCategoria.entries()]
      .sort(([a], [b]) => comparar(a, b))
      .map(([nome, n]) => ({ nome, ...n }));
    return NextResponse.json({ categorias });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const criarSchema = z.object({
  categorias: z.array(z.string()).max(200).optional(),
  soComEstoque: z.boolean().optional(),
  customerId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = criarSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const company = await db.company.findUnique({ where: { id: user.companyId }, select: { slug: true } });
    if (!company) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    // a cliente informada tem que ser DESTA loja (RN-013); fora disso, o
    // link nasce sem cliente — ele vale do mesmo jeito
    let customerId: string | null = null;
    if (parsed.data.customerId) {
      const c = await db.customer.findFirst({
        where: { id: parsed.data.customerId, companyId: user.companyId },
        select: { id: true },
      });
      customerId = c?.id ?? null;
    }
    // a vendedora do link (RN-005): quem vende leva a venda que vier; o
    // suporte gera link sem dona — operação, não comissão
    const sellerId = user.role === "SELLER" || user.role === "MANAGER" || user.role === "ADMIN" ? user.id : null;
    const categorias = normalizarCategorias(parsed.data.categorias);
    const code = await criarLinkDeFotos({
      companyId: user.companyId,
      categorias,
      soComEstoque: parsed.data.soComEstoque ?? true,
      sellerId,
      criadoPorId: user.id,
      customerId,
    });
    const url = urlDoLinkDeFotos(company.slug, code);
    const absoluta = url.startsWith("http") ? url : `${req.nextUrl.origin}${url}`;
    return NextResponse.json({ url: absoluta, categorias });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
