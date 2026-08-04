import { db } from "./db";
import { imageHref } from "./img";
import { corIgual } from "./capa-por-cor";

/**
 * RELIGAR ITENS DO PEDIDO À PEÇA ATUAL.
 *
 * Incidente real (Toque Leve, 30/07/2026): a lojista desfez a importação da
 * Nuvemshop e reimportou. Os produtos antigos foram apagados e voltaram como
 * peças NOVAS (id novo). O pedido não perdeu nada — nome, SKU, cor, tamanho e
 * preço são cópia gravada no item —, mas o PONTEIRO para a variação virou
 * nulo (`onDelete: SetNull`, que é o que protege o histórico).
 *
 * Só que a tela do pedido lê o estoque pelo ponteiro: sem ele, mostrava
 * "estoque 0 (insuficiente)" numa peça que tinha estoque de sobra na
 * Nuvemshop e no catálogo. A vendedora podia desistir de uma venda por causa
 * de um aviso falso.
 *
 * Aqui a gente reencontra a peça pelos dados que o item guardou:
 *   1. SKU da variação (chave universal — é como a integração casa)
 *   2. nome do produto + cor + tamanho (quando o item não tem SKU)
 *
 * Nunca inventa peça e nunca mexe em estoque: só conserta o ponteiro.
 */

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export type ItemQuebrado = {
  id: string;
  sku: string | null;
  name: string;
  color: string | null;
  size: string | null;
};

export type CandidataAtual = {
  variantId: string;
  productId: string;
  sku: string | null;
  produto: string;
  color: string;
  size: string;
};

/**
 * Regra pura: para cada item órfão, acha a variação atual correspondente.
 * Devolve só os pares que casaram (o que não casou fica de fora, sem chute).
 */
export function casarItens(
  quebrados: ItemQuebrado[],
  atuais: CandidataAtual[]
): { itemId: string; variantId: string; productId: string }[] {
  // SKU só serve como chave quando é ÚNICO: SKU repetido foi justamente a
  // origem da bagunça, e casar por um SKU ambíguo religaria na peça errada.
  const porSku = new Map<string, CandidataAtual[]>();
  const porNomeCorTam = new Map<string, CandidataAtual[]>();
  for (const c of atuais) {
    const k = norm(c.sku);
    if (k) {
      const l = porSku.get(k);
      if (l) l.push(c);
      else porSku.set(k, [c]);
    }
    const k2 = `${norm(c.produto)}|${norm(c.color)}|${norm(c.size)}`;
    const l2 = porNomeCorTam.get(k2);
    if (l2) l2.push(c);
    else porNomeCorTam.set(k2, [c]);
  }

  const unica = (lista: CandidataAtual[] | undefined) =>
    lista && lista.length === 1 ? lista[0] : null;

  const pares: { itemId: string; variantId: string; productId: string }[] = [];
  for (const item of quebrados) {
    const achada =
      unica(porSku.get(norm(item.sku))) ??
      unica(
        porNomeCorTam.get(
          `${norm(item.name)}|${norm(item.color)}|${norm(item.size)}`
        )
      );
    if (achada) {
      pares.push({
        itemId: item.id,
        variantId: achada.variantId,
        productId: achada.productId,
      });
    }
  }
  return pares;
}

/**
 * Conserta os ponteiros de UM pedido. Idempotente e barato: sai na hora quando
 * não há item órfão (o caso normal). Roda de carona ao abrir o pedido.
 */
export async function religarItensDoPedido(
  orderId: string,
  companyId: string
): Promise<number> {
  const quebrados = await db.orderItem.findMany({
    where: { orderId, order: { companyId }, variantId: null },
    select: { id: true, sku: true, name: true, color: true, size: true },
  });
  if (quebrados.length === 0) return 0;

  const variantes = await db.productVariant.findMany({
    where: { product: { companyId } },
    select: {
      id: true,
      sku: true,
      color: true,
      size: true,
      productId: true,
      product: { select: { name: true } },
    },
  });

  const pares = casarItens(
    quebrados,
    variantes.map((v) => ({
      variantId: v.id,
      productId: v.productId,
      sku: v.sku,
      produto: v.product.name,
      color: v.color,
      size: v.size,
    }))
  );
  if (pares.length === 0) return 0;

  await db.$transaction(
    pares.map((p) =>
      db.orderItem.update({
        where: { id: p.itemId },
        data: { variantId: p.variantId, productId: p.productId },
      })
    )
  );
  return pares.length;
}

/**
 * CONSERTA O RETRATO DO ITEM (incidente Entre Linhas, 04/08/2026): pedidos
 * antigos gravaram o SKU DO PRODUTO (que em produto importado é o da 1ª
 * variação — mostrava "Preto" num item Azul Serenity) e a foto da capa geral
 * em vez da foto da cor. Ajusta o snapshot pelo que a variação apontada diz.
 * Roda de carona ao abrir o pedido, idempotente; nunca mexe em preço,
 * quantidade ou estoque — só SKU e foto do item.
 */
export async function corrigirRetratoDosItens(
  orderId: string,
  companyId: string
): Promise<number> {
  const itens = await db.orderItem.findMany({
    where: { orderId, order: { companyId }, variantId: { not: null } },
    select: {
      id: true,
      sku: true,
      imageUrl: true,
      variant: {
        select: {
          sku: true,
          color: true,
          product: {
            select: {
              sku: true,
              images: {
                orderBy: { order: "asc" },
                select: { id: true, color: true },
              },
            },
          },
        },
      },
    },
  });
  let consertados = 0;
  for (const it of itens) {
    const v = it.variant;
    if (!v) continue;
    const skuCerto = v.sku ?? v.product.sku ?? null;
    const foto =
      v.product.images.find((im) => corIgual(im.color, v.color)) ??
      v.product.images[0];
    const fotoCerta = foto ? imageHref(foto.id) : null;
    const data: { sku?: string; imageUrl?: string } = {};
    if (skuCerto && it.sku !== skuCerto) data.sku = skuCerto;
    if (fotoCerta && it.imageUrl !== fotoCerta) data.imageUrl = fotoCerta;
    if (Object.keys(data).length > 0) {
      await db.orderItem.update({ where: { id: it.id }, data });
      consertados++;
    }
  }
  return consertados;
}
