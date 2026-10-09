import { Prisma, type OrderStatus } from "@prisma/client";
import { db } from "../db";
import type { SessionUser } from "../auth";
import { orderScope } from "../scope";
import { ordenarVariantes } from "../tamanhos";
import { donoDoEstoque, type DonoExterno } from "./dono-do-estoque";
import { minimoEfetivo, minimosDaLoja, noMinimo, type OrigemDoMinimo } from "./minimos";
import { envioPendentePorVariacao } from "../nuvemshop-estoque-pendente";
import type { PedidoQueSegura } from "./peca-presa";
import { aProduzir, vendeSobEncomenda } from "../sob-encomenda";
import { categoriasSobEncomenda } from "../sob-encomenda-data";

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

export type FiltroDoInventario = "todos" | "baixo" | "zerado" | "produzir" | "reservado" | "externo";
/** A lista dos chips, UMA para a tela, a rota, a página e a folha (lista à mão é onde chip novo se perde). */
export const FILTROS_DO_INVENTARIO: readonly FiltroDoInventario[] = ["todos", "baixo", "zerado", "produzir", "reservado", "externo"];

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
  /**
   * RN-076: a peça VENDE SOB ENCOMENDA — o disponível pode ser negativo
   * ("−3" = 3 a produzir) e o mínimo não vale para ela (negativo é esperado,
   * alerta todo dia vira barulho; o recorte dela é "A produzir").
   */
  sobEncomenda: boolean;
  /** custo e preço de atacado da peça — o painel soma "valor parado" por aqui */
  custo: number;
  atacado: number;
  /** quando o produto foi cadastrado — peça nova não é "encalhada" (RN-052) */
  cadastradoEm: string;
  /**
   * RN-053: a baixa desta peça ainda não foi confirmada pela Nuvemshop. É o
   * ⚠️ da linha — sem ele a divergência só aparecia rodando a conferência da
   * integração, e a peça ficava dias com número errado de um dos lados.
   */
  envioPendente?: boolean;
  /**
   * QUEM segura a reserva (pedido do dono, 08/10/2026: "na aba Com reserva,
   * o status do pedido e o número dele"). Só nas linhas com reservado > 0.
   * Pedido fora do recorte de quem vê (RN-007) entra SEM número e sem id —
   * só a situação e quantas peças —, como no "pedido de colega" da RN-050.
   */
  pedidos?: PedidoNaLinha[];
};

export type PedidoNaLinha = {
  orderId: string | null;
  numero: number | null;
  status: OrderStatus;
  pecas: number;
};

/**
 * Pendura em cada linha os pedidos que seguram a peça dela (pura). O número
 * e o id do pedido de colega NÃO viajam para o navegador — a régua da
 * RN-007 vale no servidor, não na tela. Ordem: pedido mais antigo primeiro.
 */
export function anexarPedidosQueSeguram<T extends Pick<LinhaDoInventario, "variantId" | "reservado">>(
  linhas: readonly T[],
  rows: readonly (PedidoQueSegura & { orderId: string; variantId: string })[]
): (T & { pedidos?: PedidoNaLinha[] })[] {
  const porVariacao = new Map<string, PedidoNaLinha[]>();
  for (const r of rows) {
    const lista = porVariacao.get(r.variantId) ?? [];
    lista.push(
      r.visivel
        ? { orderId: r.orderId, numero: r.numero, status: r.status, pecas: r.pecas }
        : { orderId: null, numero: null, status: r.status, pecas: r.pecas }
    );
    porVariacao.set(r.variantId, lista);
  }
  return linhas.map((l) => {
    if (l.reservado <= 0) return l;
    const pedidos = porVariacao.get(l.variantId);
    if (!pedidos) return l;
    pedidos.sort((a, b) => (a.numero ?? Number.MAX_SAFE_INTEGER) - (b.numero ?? Number.MAX_SAFE_INTEGER));
    return { ...l, pedidos };
  });
}

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
    /** peças devendo em variações que vendem sob encomenda (RN-076): a soma do negativo */
    aProduzir: number;
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

/**
 * QUAIS pedidos seguram estas variações, e quantas peças cada um (RN-050: a
 * recusa de remover a variação diz o número — "cancele o pedido" sem dizer
 * qual era beco sem saída numa loja cheia de pedidos). A MESMA régua do
 * `reservadoPorVariacao` (status que seguram, sem baixa definitiva, saldo do
 * livro), então a soma por pedido fecha com o número do Inventário.
 * `visivel` segue o recorte de quem pergunta (RN-007). Quem decide se o
 * pedido TRAVA a remoção é `travaARemocao` (peca-presa.ts) — o pago não.
 *
 * Aceita a transação (`cliente`): a rota relê DENTRO dela, com as variações
 * travadas, para a reserva que chega no meio não passar batida.
 */
export async function pedidosQueSeguram(
  user: SessionUser,
  variantIds: string[],
  cliente: Prisma.TransactionClient | typeof db = db
): Promise<(PedidoQueSegura & { orderId: string; variantId: string })[]> {
  if (variantIds.length === 0) return [];
  const companyId = user.companyId;
  const rows = await cliente.$queryRaw<
    { id: string; variantId: string; numero: number; status: OrderStatus; cliente: string; pecas: number }[]
  >(Prisma.sql`
    SELECT o."id", m."variantId", o."number" AS "numero", o."status", c."name" AS "cliente",
           SUM(CASE WHEN m."type" = 'SAIDA' THEN m."quantity" ELSE -m."quantity" END)::int AS "pecas"
      FROM "Order" o
      JOIN "InventoryMovement" m ON m."orderId" = o."id"
      JOIN "Customer" c ON c."id" = o."customerId"
     WHERE o."companyId" = ${companyId}
       AND o."status" = ANY(${[...STATUS_QUE_SEGURAM_NA_LOJA]}::text[]::"OrderStatus"[])
       AND o."stockWrittenOff" = false
       AND m."companyId" = ${companyId}
       AND m."variantId" = ANY(${variantIds}::text[])
       AND m."type" IN ('SAIDA', 'ENTRADA')
     GROUP BY o."id", m."variantId", o."number", o."status", c."name"
    HAVING SUM(CASE WHEN m."type" = 'SAIDA' THEN m."quantity" ELSE -m."quantity" END) > 0
  `);
  if (rows.length === 0) return [];
  const veem = await cliente.order.findMany({
    where: { AND: [orderScope(user), { id: { in: [...new Set(rows.map((r) => r.id))] } }] },
    select: { id: true },
  });
  const visiveis = new Set(veem.map((o) => o.id));
  return rows.map((r) => ({
    orderId: r.id,
    variantId: r.variantId,
    numero: r.numero,
    status: r.status,
    cliente: r.cliente,
    pecas: r.pecas,
    visivel: visiveis.has(r.id),
  }));
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
/**
 * Chegou ao mínimo? A régua da RN-051 — MENOS para a peça que vende sob
 * encomenda (RN-076): nela o negativo é esperado, e "no mínimo" nos cinco
 * lugares (filtro, painel, alerta, monitor, Dashboard) tem que concordar.
 */
/** O que as réguas puras precisam saber da encomenda (ausente = não vende sob encomenda). */
export type ComEncomenda = { sobEncomenda?: boolean };

export function chegouAoMinimo(
  l: Pick<LinhaDoInventario, "disponivel" | "minimo"> & ComEncomenda
): boolean {
  return !l.sobEncomenda && noMinimo(l.disponivel, l.minimo);
}

export function passaNoFiltro(
  filtro: FiltroDoInventario,
  l: Pick<LinhaDoInventario, "disponivel" | "reservado" | "dono" | "minimo"> & ComEncomenda
): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "zerado":
      return l.disponivel === 0;
    case "baixo":
      return chegouAoMinimo(l);
    case "produzir":
      // peça sob encomenda devendo: o negativo é o que a confecção deve fazer
      return !!l.sobEncomenda && l.disponivel < 0;
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
  sobEncomenda: boolean | null;
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
  const [minimos, produtos, reservado, catsSobEncomenda] = await Promise.all([
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
        sobEncomenda: true,
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
    categoriasSobEncomenda(companyId),
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
        sobEncomenda: vendeSobEncomenda({
          peca: p.sobEncomenda,
          categoria: catsSobEncomenda.has(p.category),
          jueriId: p.jueriId,
        }),
        custo: p.costPrice,
        atacado: p.wholesalePrice,
        cadastradoEm: p.createdAt.toISOString(),
      });
    }
  }
  return { linhas, produtos, limiteBaixo: minimos.loja };
}

/**
 * Os cartões do topo do Inventário (pura). Somam a LOJA INTEIRA ou, com a
 * categoria escolhida, SÓ ELA (pedido do dono, 08/10/2026: *"quando
 * seleciono uma categoria quero ver o estoque total daquela categoria; em
 * Todas, o total de todas"*). A busca e os chips (No mínimo, Zeradas…) NÃO
 * entram: são recorte da lista — "peças na loja" mudando a cada tecla
 * digitada faria ninguém confiar no número.
 */
export function resumirLinhas(
  linhas: readonly LinhaDoInventario[],
  categoria?: string | null
): Inventario["resumo"] {
  const todas = categoria ? linhas.filter((l) => l.categoria === categoria) : linhas;
  return {
    // "na loja" = disponível + reservado fecha mesmo com negativo: a peça sob
    // encomenda com 2 na arara e 5 vendidas está em −3 e segura 5 → 2 na loja
    pecas: todas.reduce((s, l) => s + l.emEstoque, 0),
    // "disponíveis para vender" não desce de zero: o negativo é dívida de
    // produção, contada à parte (RN-076)
    disponiveis: todas.reduce((s, l) => s + Math.max(0, l.disponivel), 0),
    reservadas: todas.reduce((s, l) => s + l.reservado, 0),
    variacoes: todas.length,
    zeradas: todas.filter((l) => l.disponivel === 0).length,
    baixas: todas.filter((l) => passaNoFiltro("baixo", l)).length,
    aProduzir: todas.reduce((s, l) => s + (l.sobEncomenda ? aProduzir(l.disponivel) : 0), 0),
    externas: todas.filter((l) => l.dono !== null).length,
    nuvemshop: todas.filter((l) => l.dono === "NUVEMSHOP").length,
  };
}

export async function montarInventario(
  companyId: string,
  opts: { q?: string; categoria?: string; filtro?: FiltroDoInventario; incluirInativos?: boolean },
  /** quem está vendo: com ele, as linhas reservadas dizem QUAL pedido segura (recorte RN-007) */
  user?: SessionUser
): Promise<Inventario> {
  // (o resumo segue só a CATEGORIA, não a busca nem os chips; a tela só o
  // pede de novo quando a categoria muda — ver `so=lista` na rota)
  const { linhas: todas, produtos, limiteBaixo } = await linhasDoEstoque(companyId, {
    incluirInativos: opts.incluirInativos,
  });
  const categorias = [...new Set(produtos.map((p) => p.category))].sort();
  const resumo = resumirLinhas(todas, opts.categoria);

  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  const filtro = opts.filtro ?? "todos";
  const filtradas = todas.filter((l) => {
    if (opts.categoria && l.categoria !== opts.categoria) return false;
    if (!passaNoFiltro(filtro, l)) return false;
    const p = porProduto.get(l.productId)!;
    const v = p.variants.find((x) => x.id === l.variantId)!;
    return casaBusca(opts.q ?? "", p, v);
  });

  // ⚠️ do envio que não chegou na Nuvemshop (RN-053): consultado SÓ para as
  // linhas que a tela vai mostrar — a fila é curta, mas a lista não é
  const visiveis = filtradas.slice(0, TETO_DE_LINHAS);
  const pendentes = await envioPendentePorVariacao(
    companyId,
    visiveis.filter((l) => l.dono === "NUVEMSHOP").map((l) => l.variantId)
  );

  // quem segura cada reserva: SÓ das linhas visíveis com reservado > 0 (a
  // mesma consulta da recusa de remover variação, RN-050) — uma ida ao banco
  const comReserva = visiveis.filter((l) => l.reservado > 0).map((l) => l.variantId);
  const seguradores = user && comReserva.length ? await pedidosQueSeguram(user, comReserva) : [];

  return {
    linhas: anexarPedidosQueSeguram(
      visiveis.map((l) => (pendentes.has(l.variantId) ? { ...l, envioPendente: true } : l)),
      seguradores
    ),
    total: filtradas.length,
    teto: TETO_DE_LINHAS,
    limiteBaixo,
    categorias,
    resumo,
  };
}

/**
 * As linhas da FOLHA DE CONTAGEM (`lib/estoque/contagem.ts`): a loja
 * inteira — sem o teto de 500 da tela, a folha é para contar tudo —, com o
 * MESMO recorte de categoria, busca e chip do Inventário, para a folha
 * impressa bater com a lista em que a contagem volta a ser digitada.
 */
export async function linhasDaContagem(
  companyId: string,
  opts: { q?: string; categoria?: string; incluirInativos?: boolean; filtro?: FiltroDoInventario }
): Promise<{ linhas: LinhaDoInventario[]; categorias: string[] }> {
  const { linhas, produtos } = await linhasDoEstoque(companyId, {
    incluirInativos: opts.incluirInativos,
  });
  const porProduto = new Map(produtos.map((p) => [p.id, p]));
  return {
    linhas: linhas.filter((l) => {
      if (opts.categoria && l.categoria !== opts.categoria) return false;
      // o chip da tela (No mínimo, Zeradas…) vale na folha também: é a lista
      // que vai para a produção (pedido do dono, 08/10/2026)
      if (!passaNoFiltro(opts.filtro ?? "todos", l)) return false;
      const p = porProduto.get(l.productId)!;
      const v = p.variants.find((x) => x.id === l.variantId)!;
      return casaBusca(opts.q ?? "", p, v);
    }),
    categorias: [...new Set(produtos.map((p) => p.category))].sort(),
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
      LEFT JOIN "SobEncomendaCategoria" s
        ON s."companyId" = p."companyId" AND s."category" = p."category"
     WHERE p."companyId" = ${companyId}
       AND p."active" = true
       AND v."stock" <= COALESCE(p."minStock", c."minStock", co."lowStockThreshold")
       -- a peça que vende SOB ENCOMENDA fica fora do mínimo (RN-076), pela
       -- MESMA escada da regra pura: peça > categoria, e Jueri nunca
       AND NOT (
         p."jueriId" IS NULL
         AND COALESCE(p."sobEncomenda", s."id" IS NOT NULL)
       )
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
