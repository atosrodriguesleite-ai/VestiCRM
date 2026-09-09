import { db } from "../db";
import type { OrigemDoMinimo } from "./minimos-regra";

export * from "./minimos-regra";
export type { OrigemDoMinimo };

/** Os mínimos da loja, prontos para casar com cada variação. */
export async function minimosDaLoja(companyId: string): Promise<{
  loja: number;
  porCategoria: Map<string, number>;
}> {
  const [company, cats] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { lowStockThreshold: true } }),
    db.estoqueMinimoCategoria.findMany({
      where: { companyId },
      select: { category: true, minStock: true },
    }),
  ]);
  return {
    loja: company?.lowStockThreshold ?? 5,
    porCategoria: new Map(cats.map((c) => [c.category, c.minStock])),
  };
}

/** Grava (ou limpa, com null) o mínimo de uma categoria da loja. */
export async function salvarMinimoDaCategoria(
  companyId: string,
  category: string,
  minStock: number | null
): Promise<void> {
  const cat = category.trim();
  if (!cat) return;
  if (minStock === null) {
    await db.estoqueMinimoCategoria.deleteMany({ where: { companyId, category: cat } });
    return;
  }
  await db.estoqueMinimoCategoria.upsert({
    where: { companyId_category: { companyId, category: cat } },
    update: { minStock },
    create: { companyId, category: cat, minStock },
  });
}

/** Grava (ou limpa, com null) o mínimo de uma peça. Devolve false se não é da loja. */
export async function salvarMinimoDaPeca(
  companyId: string,
  productId: string,
  minStock: number | null
): Promise<boolean> {
  const r = await db.product.updateMany({
    where: { id: productId, companyId },
    data: { minStock },
  });
  return r.count > 0;
}
