import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { porteiraEstoque, podeAjustarEstoque } from "@/lib/estoque/gate";
import { minimosDaLoja, salvarMinimoDaCategoria, TETO_DO_MINIMO } from "@/lib/estoque/minimos";
import { parseCategoryOrder } from "@/lib/categories";

export const dynamic = "force-dynamic";

/** As categorias da loja: as usadas em produtos + as criadas à mão. */
async function categoriasDaLoja(companyId: string): Promise<string[]> {
  const [produtos, company] = await Promise.all([
    db.product.findMany({ where: { companyId }, select: { category: true }, distinct: ["category"] }),
    db.company.findUnique({ where: { id: companyId }, select: { extraCategories: true } }),
  ]);
  return [
    ...new Set([...produtos.map((p) => p.category), ...parseCategoryOrder(company?.extraCategories)]),
  ].sort();
}

/** Os mínimos da loja (RN-051): o da loja, os por categoria e as categorias existentes. */
export async function GET() {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    const companyId = porta.user.companyId;
    const [minimos, categorias] = await Promise.all([minimosDaLoja(companyId), categoriasDaLoja(companyId)]);
    return NextResponse.json({
      loja: minimos.loja,
      categorias: categorias.map((c) => ({ categoria: c, minimo: minimos.porCategoria.get(c) ?? null })),
      podeAjustar: podeAjustarEstoque(porta.user),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  /** mínimo da loja (o de sempre, `lowStockThreshold`) */
  loja: z.number().int().min(0).max(TETO_DO_MINIMO).optional(),
  /** mínimo de UMA categoria; null limpa (volta a valer o da loja) */
  categoria: z.string().trim().min(1).max(80).optional(),
  minimo: z.number().int().min(0).max(TETO_DO_MINIMO).nullable().optional(),
});

/** Grava o mínimo da loja e/ou de uma categoria — gerência. */
export async function PATCH(req: NextRequest) {
  try {
    const porta = await porteiraEstoque();
    if (!porta.ok) return porta.resposta;
    if (!podeAjustarEstoque(porta.user)) {
      return NextResponse.json({ error: "Só gerente ou admin define mínimos." }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { loja, categoria, minimo } = parsed.data;
    const companyId = porta.user.companyId;
    if (loja !== undefined) {
      await db.company.update({ where: { id: companyId }, data: { lowStockThreshold: loja } });
    }
    if (categoria !== undefined) {
      if (minimo === undefined) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
      // só categoria que EXISTE na loja (texto exato): "vestidos" com caixa
      // diferente gravaria um mínimo invisível que nunca valeria para ninguém
      const existe = await categoriasDaLoja(companyId);
      if (!existe.includes(categoria)) {
        return NextResponse.json({ error: "Essa categoria não existe na loja." }, { status: 400 });
      }
      await salvarMinimoDaCategoria(companyId, categoria, minimo);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
