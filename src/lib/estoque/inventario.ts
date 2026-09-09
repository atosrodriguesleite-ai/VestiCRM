import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import { orderScope } from "../scope";
import { ordenarVariantes } from "../tamanhos";
import { donoDoEstoque, type DonoExterno } from "./dono-do-estoque";
import { minimoEfetivo, minimosDaLoja, noMinimo, type OrigemDoMinimo } from "./minimos";

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
 *
 * Cada linha carrega também o MÍNIMO que vale para ela (RN-051: peça >
 * categoria > loja) — é a mesma linha que o painel, o alerta e o Dashboard
 * leem, para nenhum deles discordar sobre a mesma peça.
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
  /** o mínimo que vale para ESTA variação e de onde veio (RN-051) */
  minimo: number;
  origemDoMinimo: OrigemDoMinimo;
  /** custo e preço de atacado da peça — o painel soma "valor parado" por aqui */
  custo: number;
  atacado: number;
  /** quando o produto foi cadastrado — peça nova não é "encalhada" (RN-052) */
  cadastradoEm: string;
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
export const TETO_DO_HISTORICO = 100;

/**
 * Quanto cada variação tem reservado em pedido que ainda está na loja.
 *
 * Pedido cancelado com BAIXA DEFINITIVA (brinde/perda, RN-004) e depois
 * reaberto (REANEXAR) fica de fora: a SAÍDA dele segue no livro sem
 * devolução, mas a peça foi embora de verdade — contá-la mostraria 3
 * "reservadas" numa arara vazia (achado da revisão). A consulta parte dos
 * pedidos seguradores (índice `InventoryMovement_orderId_idx`).
 */
export async function reservadoPorVariacao(companyId: string): Promise<Map<string, number>> {
  // parte dos PEDIDOS seguradores (índice Order(companyId,status) — o cast
  // fica do lado do parâmetro, senão o planner ignora o índice) e vai ao
  // livro pelo índice por pedido: lê só os movimentos dos pedidos abertos,
  // não o livro inteiro da loja (achado da revisão de performance)
  const rows = await db.$queryRaw<{ variantId: string; reservado: number }[]>(Prisma.sql`
    SELECT m."variantId",
           SUM(CASE WHEN m."type" = 'SAIDA' THEN m."quantity" ELSE -m."quantity" END)::int AS "reservado"
      FROM "Order" o
      JOIN "InventoryMovement" m ON m."orderId" = o."id"
     WHERE o."companyId" = ${companyId}
       AND o."status" = ANY(${[...STATUS_QUE_SEGURAM_NA_LOJA]}::text[]::"OrderStatus"[])
       AND o."stockWrittenOff" = false
       AND m."companyId" = ${companyId}
       AND m."type" IN ('SAIDA', 'ENTRADA')
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

/**
 * A linha passa no filtro escolhido? (pura) — "baixo" é pelo mínimo DELA e
 * INCLUI a zerada (zerada também chegou ao mínimo): o sino, o Dashboard e o
 * painel contam assim, e a lista que o sino abre tem que mostrar o mesmo
 * número (achado da revisão de telas). "Zeradas" é o recorte mais estreito.
 */
export function passaNoFiltro(
  filtro: FiltroDoInventario,
  l: Pick<LinhaDoInventario, "disponivel" | "reservado" | "dono" | "minimo">
): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "zerado":
      return l.disponivel === 0;
    case "baixo":
      return noMinimo(l.disponivel, l.minimo);
    case "reservado":
      return l.reservado > 0;
    case "externo":
      return l.dono !== null;
  }
}

type ProdutoBase = {
  id: string;
  name: string;
  sku: string;
  category: string;
  tags: string | null;
  active: boolean;
  jueriId: string | null;
  minStock: number | null;
  costPrice: number;
  wholesalePrice: number;
  createdAt: Date;
  variants: { id: string; color: string; size: string; stock: number; sku: string | null; nuvemshopId: string | null }[];
};

/**
 * TODAS as linhas do estoque da loja, com reservado e mínimo já casados.
 * É a fonte única do Inventário, do painel (análise), do alerta de mínimo e
 * do cartão do Dashboard.
 */
export async function linhasDoEstoque(
  companyId: string,
  opts: { incluirInativos?: boolean; semReservado?: boolean } = {}
): Promise<{ linhas: LinhaDoInventario[]; produtos: ProdutoBase[]; limiteBaixo: number }> {
  const [minimos, produtos, reservado] = await Promise.all([
    minimosDaLoja(companyId),
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
        minStock: true,
        costPrice: true,
        wholesalePrice: true,
        createdAt: true,
        variants: {
          select: { id: true, color: true, size: true, stock: true, sku: true, nuvemshopId: true },
        },
      },
    }),
    // a varredura do alerta não usa o reservado — é a consulta mais cara
    opts.semReservado ? new Map<string, number>() : reservadoPorVariacao(companyId),
  ]);

  const linhas: LinhaDoInventario[] = [];
  for (const p of produtos) {
    const min = minimoEfetivo({
      peca: p.minStock,
      categoria: minimos.porCategoria.get(p.category),
      loja: minimos.loja,
    });
    for (const v of ordenarVariantes(p.variants)) {
      const res = reservado.get(v.id) ?? 0;
      linhas.push({
        variantId: v.id,
        productId: p.id,
        produto: p.name,
        categoria: p.category,
        cor: v.color,
        tamanho: v.size,
        sku: v.sku?.trim() || p.sku,
        ativo: p.active,
        disponivel: v.stock,
        reservado: res,
        emEstoque: v.stock + res,
        dono: donoDoEstoque({ nuvemshopId: v.nuvemshopId, product: { jueriId: p.jueriId } }),
        minimo: min.valor,
        origemDoMinimo: min.origem,
        custo: p.costPrice,
        atacado: p.wholesalePrice,
        cadastradoEm: p.createdAt.toISOString(),
      });
    }
  }
  return { linhas, produtos, limiteBaixo: minimos.loja };
}

export async function montarInventario(
  companyId: string,
  opts: { q?: string; categoria?: string; filtro?: FiltroDoInventario; incluirInativos?: boolean }
): Promise<Inventario> {
  // (o resumo é da loja inteira e não depende da busca; a tela só o pede
  // na primeira carga — ver `so=lista` na rota)
  const { linhas: todas, produtos, limiteBaixo } = await linhasDoEstoque(companyId, {
    incluirInativos: opts.incluirInativos,
  });
  const categorias = [...new Set(produtos.map((p) => p.category))].sort();

  // o resumo é da loja INTEIRA (o filtro é só da lista) — senão "peças em
  // estoque" mudaria a cada busca e ninguém confiaria no número
  const resumo = {
    pecas: todas.reduce((s, l) => s + l.emEstoque, 0),
    disponiveis: todas.reduce((s, l) => s + l.disponivel, 0),
    reservadas: todas.reduce((s, l) => s + l.reservado, 0),
    variacoes: todas.length,
    zeradas: todas.filter((l) => l.disponivel === 0).length,
    baixas: todas.filter((l) => passaNoFiltro("baixo", l)).length,
    externas: todas.filter((l) => l.dono !== null).length,
    nuvemshop: todas.filter((l) => l.dono === "NUVEMSHOP").length,
  };

  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const filtro = opts.filtro ?? "todos";
  const filtradas = todas.filter((l) => {
    if (opts.categoria && l.categoria !== opts.categoria) return false;
    if (!passaNoFiltro(filtro, l)) return false;
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
 * Quantas variações de produto ativo chegaram ao mínimo (cartão do
 * Dashboard). UMA SQL com a MESMA expressão de `minimoEfetivo` + `noMinimo`
 * (peça > categoria > loja, disponível ≤ mínimo): o Dashboard é a tela mais
 * aberta, e carregar a loja inteira para devolver um número era o item mais
 * caro dela (achado da revisão de performance). O teste da RN-051 confere a
 * SQL contra a função pura sobre os mesmos dados.
 */
export async function contarNoMinimo(companyId: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS n
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      JOIN "Company" co ON co."id" = p."companyId"
      LEFT JOIN "EstoqueMinimoCategoria" c
        ON c."companyId" = p."companyId" AND c."category" = p."category"
     WHERE p."companyId" = ${companyId}
       AND p."active" = true
       AND v."stock" <= COALESCE(p."minStock", c."minStock", co."lowStockThreshold")
  `);
  return rows[0]?.n ?? 0;
}

/** "Reserva — pedido #482" vira "Reserva — pedido de colega" (RN-007). */
export function motivoSemPedido(reason: string): string {
  return reason.replace(/pedido\s*#?\s*\d+/gi, "pedido de colega");
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
    take: TETO_DO_HISTORICO + 1,
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
    // o corte é DITO à tela (padrão da RN-036), nunca escondido
    cortado: movs.length > TETO_DO_HISTORICO,
    movimentos: movs.slice(0, TETO_DO_HISTORICO).map((m) => ({
      id: m.id,
      tipo: m.type,
      quantidade: m.quantity,
      // o TEXTO do motivo também carrega o número ("Reserva — pedido #482"):
      // fora do recorte ele é mascarado, senão o link some e o número fica
      motivo: m.orderId && !numero.has(m.orderId) ? motivoSemPedido(m.reason ?? "") : m.reason ?? "",
      quando: m.createdAt.toISOString(),
      // pedido fora do recorte de quem vê: o movimento fica, o link não
      pedido:
        m.orderId && numero.has(m.orderId)
          ? { id: m.orderId, numero: numero.get(m.orderId)! }
          : null,
    })),
  };
}
