import { db } from "./db";

/**
 * Recuperação de estoque a partir do HISTÓRICO (InventoryMovement).
 *
 * O cadastro/edição normal registra cada mudança de estoque:
 *   • ENTRADA  → soma a quantidade
 *   • SAIDA    → subtrai a quantidade
 *   • AJUSTE   → define o valor (a razão guarda "(antigo → novo)")
 *
 * A importação da Nuvemshop NÃO registrava movimento — então, replayando o
 * histórico de cada variação, chegamos ao estoque de ANTES da importação.
 * Onde esse valor difere do atual, é o que a importação sobrescreveu.
 *
 * Variações sem histórico suficiente (ou com AJUSTE sem "→") ficam como
 * "incerto" e não são propostas automaticamente — o lojista ajusta à mão.
 */

export type RestoreRow = {
  variantId: string;
  product: string;
  color: string;
  size: string;
  current: number;
  proposed: number;
};

export type RestorePreview = {
  rows: RestoreRow[]; // variações onde dá pra restaurar (valor != atual)
  incertas: number; // variações que não deu pra calcular (ajuste manual)
};

/** Reconstrói o estoque de antes da importação para todas as variações. */
export async function reconstructStock(companyId: string): Promise<RestorePreview> {
  const variants = await db.productVariant.findMany({
    where: { product: { companyId } },
    select: {
      id: true,
      color: true,
      size: true,
      stock: true,
      product: { select: { name: true } },
      movements: {
        orderBy: { createdAt: "asc" },
        select: { type: true, quantity: true, reason: true },
      },
    },
  });

  const rows: RestoreRow[] = [];
  let incertas = 0;

  for (const v of variants) {
    if (v.movements.length === 0) {
      // sem histórico: não dá pra reconstruir com segurança
      if (v.stock !== 0) incertas++;
      continue;
    }
    let running = 0;
    let uncertain = false;
    for (const mv of v.movements) {
      if (mv.type === "ENTRADA") running += mv.quantity;
      else if (mv.type === "SAIDA") running -= mv.quantity;
      else {
        // AJUSTE: a razão traz "(antigo → novo)" — usamos o "novo"
        const m = mv.reason?.match(/→\s*(\d+)/);
        if (m) running = parseInt(m[1], 10);
        else uncertain = true;
      }
    }
    if (uncertain) {
      if (running !== v.stock) incertas++;
      continue;
    }
    const proposed = Math.max(0, running);
    if (proposed !== v.stock) {
      rows.push({
        variantId: v.id,
        product: v.product.name,
        color: v.color,
        size: v.size,
        current: v.stock,
        proposed,
      });
    }
  }

  rows.sort((a, b) => a.product.localeCompare(b.product) || a.color.localeCompare(b.color));
  return { rows, incertas };
}

/** Aplica a restauração: seta o estoque reconstruído e registra o AJUSTE. */
export async function applyStockRestore(companyId: string, userName: string): Promise<number> {
  const { rows } = await reconstructStock(companyId);
  let alterados = 0;
  for (const r of rows) {
    await db.productVariant.update({ where: { id: r.variantId }, data: { stock: r.proposed } });
    await db.inventoryMovement.create({
      data: {
        companyId,
        variantId: r.variantId,
        type: "AJUSTE",
        quantity: Math.abs(r.proposed - r.current),
        reason: `Restauração pós-importação por ${userName} (${r.current} → ${r.proposed})`,
      },
    });
    alterados++;
  }
  return alterados;
}
