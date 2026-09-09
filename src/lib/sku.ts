import { db } from "./db";

/**
 * O CÓDIGO DO MODELO (`Product.sku`) NÃO É OBRIGATÓRIO NA TELA.
 *
 * Pedido do dono (09/09/2026): "quando vou criar um produto ele exige SKU,
 * de forma errada, porque o SKU eu coloco na variação depois". É verdade:
 * na moda o SKU que importa é o de cada COR e TAMANHO (é ele que casa com
 * a loja online, RN-014), e ele fica na grade, depois que o produto existe.
 *
 * O código do produto continua existindo por baixo — é único por loja, sai
 * na lista, na busca e na exportação, e é a reserva quando uma variação não
 * tem SKU próprio — mas quem não quer pensar nele não precisa: fica em
 * branco e o sistema cria um pelo nome, com a MESMA régua da importação de
 * catálogo ("Vestido Midi" → VESTIDOMID). Dá para trocar depois na edição.
 */
export function codigoDoModelo(nome: string): string {
  const letras = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // sem acento
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "") // só letra e número
    .slice(0, 10);
  return letras || "PROD";
}

/**
 * Um código que ainda não existe na loja: o do nome e, se já tiver, -2, -3…
 * (dois "Vestido Midi" viram VESTIDOMID e VESTIDOMID-2).
 */
export async function codigoDoModeloDisponivel(companyId: string, nome: string): Promise<string> {
  const base = codigoDoModelo(nome);
  const usados = new Set(
    (
      await db.product.findMany({
        where: { companyId, sku: { startsWith: base } },
        select: { sku: true },
      })
    ).map((p) => p.sku)
  );
  let sku = base;
  for (let n = 2; usados.has(sku); n++) sku = `${base}-${n}`;
  return sku;
}
