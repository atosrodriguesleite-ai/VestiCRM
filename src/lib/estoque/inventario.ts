import { Prisma } from "@prisma/client";
import { db } from "../db";
import { ordenarVariantes } from "../tamanhos";
import type { SessionUser } from "../auth";
import { orderScope } from "../scope";
import { donoDoEstoque, type DonoExterno } from "./dono-do-estoque";

/**
 * O INVENTÁRIO (RN-050): uma linha por variação (cor × tamanho), com os
 * três números que a lojista pergunta — quantas peças ESTÃO na loja, quantas
 * já estão RESERVADAS em pedido (ainda aqui dentro, esperando pagamento ou
 * separação) e quantas estão DISPONÍVEIS para vender.
 *
 * `ProductVariant.stock` é o DISPONÍVEL: a reserva do pedido já desconta
 * dele (RN-003). O reservado sai do LIVRO DE MOVIMENTOS, não da quantidade
 * do item — reserva parcial (pediu 10, havia 4) segurou 4, e é 4 que está
 * na arara com etiqueta de alguém (mesma verdade de `estoque-do-pedido.ts`).
 * Pedido que já SAIU (enviado/entregue) não reserva nada: a peça foi
 * embora. Em estoque = disponível + reservado.
 */

/** Pedido nestes status segura peça que ainda está DENTRO da loja. */
export const STATUS_QUE_SEGURAM_NA_LOJA = [
  "ORCAMENTO",
  "AGUARDANDO_PAGAMENTO",
  "PAGO",
  "EM_PRODUCAO",
  "SEPARACAO",
] as const;

export type FiltroDoInventario = "todos" | "baixo" | "zerado" | "reservado" | "externo";

export type LinhaDoInventario = {
  variantId: string;
  productId: string;
  produto: string;
  categoria: string;
  cor: string;
  tamanho: string;
  /** SKU da variação; sem ele, o código do modelo */
  sku: string;
  ativo: boolean;
  disponivel: number;
  reservado: number;
  emEstoque: number;
  dono: DonoExterno | null;
};

export type Inventario = {
  linhas: LinhaDoInventario[];
  /** quantas linhas casam com o filtro (a lista pode estar cortada) */
  total: number;
  /** teto da lista — acima disso a tela pede para refinar a busca */
  teto: number;
  limiteBaixo: number;
  categorias: string[];
  resumo: {
    pecas: number;
    disponiveis: number;
    reservadas: number;
    variacoes: number;
    zeradas: number;
    baixas: number;
    externas: number;
    /** só as da Nuvemshop — é para elas que o botão de sincronizar existe */
    nuvemshop: number;
  };
};

export const TETO_DE_LINHAS = 500;

/** Quanto cada variação tem reservado em pedido que ainda está na loja. */
export async function reservadoPorVariacao(companyId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ variantId: string; reservado: number }[]>(Prisma.sql`
    SELECT m."variantId",
           SUM(CASE WHEN m."type" = 'SAIDA' THEN m."quantity" ELSE -m."quantity" END)::int AS "reservado"
      FROM "InventoryMovement" m
      JOIN "Order" o ON o."id" = m."orderId"
     WHERE m."companyId" = ${companyId}
       AND o."companyId" = ${companyId}
       AND m."type" IN ('SAIDA', 'ENTRADA')
       AND o."status"::text IN (${Prisma.join([...STATUS_QUE_SEGURAM_NA_LOJA])})
     GROUP BY m."variantId"
  `);
  const m = new Map<string, number>();
  for (const r of rows) if (r.reservado > 0) m.set(r.variantId, r.reservado);
  return m;
}

/** O texto da busca casa com nome, código, SKU da variação ou tag? (pura) */
export function casaBusca(
  q: string,
  p: { name: string; sku: string; tags: string | null },
  v: { sku: string | null }
): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [p.name, p.sku, p.tags ?? "", v.sku ?? ""].some((x) => x.toLowerCase().includes(t));
}

/** A linha passa no filtro escolhido? (pura) */
export function passaNoFiltro(
  filtro: FiltroDoInventario,
  l: Pick<LinhaDoInventario, "disponivel" | "reservado" | "dono">,
  limiteBaixo: number
): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "zerado":
      return l.disponivel === 0;
    case "baixo":
      return l.disponivel > 0 && l.disponivel <= limiteBaixo;
    case "reservado":
      return l.reservado > 0;
    case "externo":
      return l.dono !== null;
  }
}

export async function montarInventario(
  companyId: string,
  opts: { q?: string; categoria?: string; filtro?: FiltroDoInventario; incluirInativos?: boolean }
): Promise<Inventario> {
  const [company, produtos, reservado] = await Promise.all([
    db.company.findUnique({ where: { id: companyId }, select: { lowStockThreshold: true } }),
    db.product.findMany({
      where: { companyId, ...(opts.incluirInativos ? {} : { active: true }) },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        tags: true,
        active: true,
        jueriId: true,
        variants: {
          select: { id: true, color: true, size: true, stock: true, sku: true, nuvemshopId: true },
        },
      },
    }),
    reservadoPorVariacao(companyId),
  ]);
  const limiteBaixo = company?.lowStockThreshold ?? 5;
  const categorias = [...new Set(produtos.map((p) => p.category))].sort();

  const todas: LinhaDoInventario[] = [];
  for (const p of produtos) {
    for (const v of ordenarVariantes(p.variants)) {
      const disponivel = v.stock;
      const res = reservado.get(v.id) ?? 0;
      todas.push({
        variantId: v.id,
        productId: p.id,
        produto: p.name,
        categoria: p.category,
        cor: v.color,
        tamanho: v.size,
        sku: v.sku?.trim() || p.sku,
        ativo: p.active,
        disponivel,
        reservado: res,
        emEstoque: disponivel + res,
        dono: donoDoEstoque({ nuvemshopId: v.nuvemshopId, product: { jueriId: p.jueriId } }),
      });
    }
  }

  // o resumo é da loja INTEIRA (o filtro é só da lista) — senão "peças em
  // estoque" mudaria a cada busca e ninguém confiaria no número
  const resumo = {
    pecas: todas.reduce((s, l) => s + l.emEstoque, 0),
    disponiveis: todas.reduce((s, l) => s + l.disponivel, 0),
    reservadas: todas.reduce((s, l) => s + l.reservado, 0),
    variacoes: todas.length,
    zeradas: todas.filter((l) => l.disponivel === 0).length,
    baixas: todas.filter((l) => passaNoFiltro("baixo", l, limiteBaixo)).length,
    externas: todas.filter((l) => l.dono !== null).length,
    nuvemshop: todas.filter((l) => l.dono === "NUVEMSHOP").length,
  };

  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const filtro = opts.filtro ?? "todos";
  const filtradas = todas.filter((l) => {
    if (opts.categoria && l.categoria !== opts.categoria) return false;
    if (!passaNoFiltro(filtro, l, limiteBaixo)) return false;
    const p = porProduto.get(l.productId)!;
    const v = p.variants.find((x) => x.id === l.variantId)!;
    return casaBusca(opts.q ?? "", p, v);
  });

  return {
    linhas: filtradas.slice(0, TETO_DE_LINHAS),
    total: filtradas.length,
    teto: TETO_DE_LINHAS,
    limiteBaixo,
    categorias,
    resumo,
  };
}

/**
 * Histórico de UMA variação: quem mexeu, quando, por quê — mais recente
 * primeiro. O MOVIMENTO toda a equipe vê (é o estoque da loja); o NÚMERO e o
 * link do pedido só quem enxerga aquele pedido (`orderScope`, RN-007) — a
 * vendedora vê "−2 · reserva" da colega, sem saber de quem é o pedido.
 */
export async function historicoDaVariacao(user: SessionUser, variantId: string) {
  const companyId = user.companyId;
  const v = await db.productVariant.findFirst({
    where: { id: variantId, product: { companyId } },
    select: { id: true, color: true, size: true, stock: true, product: { select: { name: true } } },
  });
  if (!v) return null;
  const movs = await db.inventoryMovement.findMany({
    where: { companyId, variantId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, type: true, quantity: true, reason: true, createdAt: true, orderId: true },
  });
  const orderIds = [...new Set(movs.flatMap((m) => (m.orderId ? [m.orderId] : [])))];
  const pedidos = orderIds.length
    ? await db.order.findMany({
        where: { id: { in: orderIds }, ...orderScope(user) },
        select: { id: true, number: true },
      })
    : [];
  const numero = new Map(pedidos.map((o) => [o.id, o.number]));
  return {
    peca: v,
    movimentos: movs.map((m) => ({
      id: m.id,
      tipo: m.type,
      quantidade: m.quantity,
      motivo: m.reason ?? "",
      quando: m.createdAt.toISOString(),
      // pedido fora do recorte de quem vê: o movimento fica, o link não
      pedido:
        m.orderId && numero.has(m.orderId)
          ? { id: m.orderId, numero: numero.get(m.orderId)! }
          : null,
    })),
  };
}
