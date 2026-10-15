import { db } from "./db";

/**
 * A chavinha "vende sob encomenda" (RN-076) — a parte que lê e grava o banco.
 * A regra pura mora em `lib/sob-encomenda.ts`.
 */

/** As categorias da loja que vendem sob encomenda. */
export async function categoriasSobEncomenda(companyId: string): Promise<Set<string>> {
  const linhas = await db.sobEncomendaCategoria.findMany({
    where: { companyId },
    select: { category: true },
  });
  return new Set(linhas.map((l) => l.category));
}

/** Liga (true) ou desliga (false) a chavinha de uma categoria da loja. */
export async function salvarEncomendaDaCategoria(
  companyId: string,
  category: string,
  ligada: boolean
): Promise<void> {
  const cat = category.trim();
  if (!cat) return;
  if (!ligada) {
    await db.sobEncomendaCategoria.deleteMany({ where: { companyId, category: cat } });
    return;
  }
  await db.sobEncomendaCategoria.upsert({
    where: { companyId_category: { companyId, category: cat } },
    update: {},
    create: { companyId, category: cat },
  });
}
