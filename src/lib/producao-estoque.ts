import { db } from "./db";
import { norm, baseNome, corDoNome, pushStockToNuvemshop } from "./nuvemshop";

/**
 * Entrada de peças prontas no estoque REAL do catálogo, com o mesmo
 * casamento da integração (nome exato ou família "Modelo — Cor" + variação
 * por cor/tamanho). Usada pelo lançamento da costura e pela volta dos lotes.
 * Devolve o destino quando casou; null quando o catálogo não tem a peça.
 */
export async function lancaNoEstoque(
  companyId: string,
  userName: string,
  sku: { productName: string; color?: string | null; size?: string | null },
  pieces: number,
  motivo: string
): Promise<string | null> {
  const produtos = await db.product.findMany({
    where: { companyId },
    include: { variants: true },
  });
  for (const p of produtos) {
    const sufixo = corDoNome(p.name);
    const casaProduto = sufixo
      ? norm(baseNome(p.name)) === norm(sku.productName) &&
        (!sku.color || norm(sufixo) === norm(sku.color))
      : norm(p.name) === norm(sku.productName);
    if (!casaProduto) continue;
    const v = p.variants.find(
      (x) =>
        (!sku.color || norm(x.color) === norm(sku.color)) &&
        (!sku.size || norm(x.size) === norm(sku.size))
    );
    if (!v) continue;
    await db.productVariant.update({
      where: { id: v.id },
      data: { stock: { increment: pieces } },
    });
    await db.inventoryMovement.create({
      data: {
        companyId,
        variantId: v.id,
        type: "ENTRADA",
        quantity: pieces,
        reason: `${motivo} por ${userName}`,
      },
    });
    pushStockToNuvemshop(companyId, [v.id]).catch(() => {});
    return `${p.name} · ${v.color} · ${v.size}`;
  }
  return null;
}
