import { db } from "./db";
import { PAID_ORDER_STATUSES } from "./orders";
import type { SessionUser } from "./auth";
import type { CustomerType, Prisma } from "@prisma/client";
import { biLiberado, podeVerBi } from "./bi/gate";
import { clientesDoRfm } from "./bi/rfm";
import { ehGrupoRfm, type GrupoRfm } from "./bi/rfm-regra";

/**
 * Filtro de segmentação de campanhas (item 8 do produto).
 * Salvo como JSON no campo Campaign.filterJson.
 */
export type SegmentFilter = {
  inactiveDays?: number; // sem compra há X dias (30/60/90...)
  type?: CustomerType; // atacado, varejo...
  city?: string;
  minSpent?: number; // ticket alto: total gasto >= X
  interest?: string; // nome do interesse/produto
  tag?: string; // nome da tag
  lostDeals?: boolean; // abandonou negociação
  rfmGrupo?: GrupoRfm; // grupo do RFM do BI (RN-098) — só gerência, com o BI ligado
};

/** O grupo do RFM é um filtro de verdade (da lista fechada), não um texto qualquer do JSON salvo. */
export function grupoDoFiltro(filter: SegmentFilter): GrupoRfm | null {
  return ehGrupoRfm(filter?.rfmGrupo) ? filter.rfmGrupo! : null;
}

/**
 * O filtro salvo da campanha, ou `null` quando ele não se lê. Ilegível NUNCA
 * vira `{}`: filtro vazio é "todas as clientes", e um JSON cortado de uma
 * campanha "Não posso perder" viraria disparo para a loja inteira (achado da
 * revisão, RN-098). Quem chama trata o `null` como público vazio.
 */
export function lerFiltroDaCampanha(filterJson: string | null | undefined): SegmentFilter | null {
  try {
    const f = JSON.parse(filterJson || "{}");
    return f && typeof f === "object" && !Array.isArray(f) ? (f as SegmentFilter) : null;
  } catch {
    return null;
  }
}

/**
 * Por que o grupo do RFM está fechado para esta pessoa (RN-098): a MESMA
 * porteira do BI (RN-082) — gerência, na loja com a chave. `null` = aberto.
 * O RFM é do BI, e a campanha não pode virar a porta dos fundos para ver quem
 * é "Não posso perder" de uma loja sem o módulo, nem para a vendedora. Os
 * dois motivos são ditos separados: a gerente da loja que desligou o BI não
 * pode ler "só a gerência".
 */
export function barreiraDoRfm(user: Pick<SessionUser, "role">, biEnabled: boolean): null | "papel" | "bi" {
  if (!podeVerBi(user)) return "papel";
  if (!biLiberado(biEnabled)) return "bi";
  return null;
}

export async function rfmLiberadoPara(user: SessionUser): Promise<boolean> {
  if (!podeVerBi(user)) return false;
  const c = await db.company.findUnique({ where: { id: user.companyId }, select: { biEnabled: true } });
  return barreiraDoRfm(user, c?.biEnabled ?? false) === null;
}

/** cliente → grupo de HOJE; `null` quando quem pergunta não pode ver o RFM */
export type GruposDoRfm = Map<string, GrupoRfm> | null;

/** `liberado` já conferido por quem chama poupa a ida ao banco da porteira */
export async function gruposDoRfmPara(user: SessionUser, liberado?: boolean): Promise<GruposDoRfm> {
  if (!(liberado ?? (await rfmLiberadoPara(user)))) return null;
  return new Map((await clientesDoRfm(user.companyId)).map((c) => [c.id, c.grupo]));
}

/**
 * Lê os grupos uma vez só por requisição (a tela de Campanhas avalia o
 * público de cada campanha; cada uma refazendo o RFM seria a consulta
 * agregada da loja repetida N vezes).
 */
export function gruposDoRfmUmaVez(user: SessionUser, liberado?: boolean): () => Promise<GruposDoRfm> {
  let p: Promise<GruposDoRfm> | null = null;
  return () => (p ??= gruposDoRfmPara(user, liberado));
}

export async function evaluateSegment(
  user: SessionUser,
  filter: SegmentFilter,
  ctx: { gruposDoRfm?: () => Promise<GruposDoRfm> } = {}
) {
  // GRUPO DO RFM (RN-098): sem permissão o público é VAZIO, nunca a loja
  // inteira — ignorar o filtro que a pessoa não pode usar mandaria a
  // mensagem de "sentimos sua falta" para todas as clientes.
  let doGrupo: Set<string> | null = null;
  if (filter?.rfmGrupo != null) {
    const grupo = grupoDoFiltro(filter);
    if (!grupo) return [];
    const grupos = await (ctx.gruposDoRfm ?? (() => gruposDoRfmPara(user)))();
    if (!grupos) return [];
    doGrupo = new Set([...grupos].filter(([, g]) => g === grupo).map(([id]) => id));
    if (doGrupo.size === 0) return [];
  }

  // cliente BLOQUEADA não entra em campanha nenhuma (RN-098): o bloqueio é o
  // de verdade no WhatsApp, e a lista do BI já não oferece o "Chamar" a ela
  const where: Prisma.CustomerWhereInput = { companyId: user.companyId, blockedAt: null };

  if (filter.inactiveDays) {
    const cutoff = new Date(
      Date.now() - filter.inactiveDays * 24 * 60 * 60 * 1000
    );
    // "Sem compra há X dias" olha OS PRÓPRIOS PEDIDOS PAGOS — a mesma fonte
    // do faturamento. O carimbo `lastPurchaseAt` não é gravado em todos os
    // caminhos, e cliente que COMPROU podia receber mensagem de "sentimos
    // sua falta" (a pior mensagem errada possível numa campanha).
    where.orders = {
      none: {
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: cutoff },
      },
    };
    // e quem ENTROU depois do corte fica de fora: lead de anteontem não
    // "está sem comprar há 60 dias" — nem teve 60 dias para isso
    where.createdAt = { lt: cutoff };
  }
  if (filter.type) where.type = filter.type;
  if (filter.city) where.city = { contains: filter.city, mode: "insensitive" };
  if (filter.interest) {
    where.interests = { some: { interest: { name: filter.interest } } };
  }
  if (filter.tag) {
    where.tags = { some: { tag: { name: filter.tag } } };
  }
  if (filter.lostDeals) {
    where.opportunities = { some: { status: "LOST" } };
  }

  // total gasto = pedidos PAGOS (fonte única; inclui vendas integradas),
  // somando netTotal — valor comprado, sem frete (regra das telas de dinheiro)
  let customers = await db.customer.findMany({
    where,
    include: {
      orders: {
        where: { status: { in: PAID_ORDER_STATUSES } },
        select: { netTotal: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // o grupo é conferido em memória (a mesma régua do gasto mínimo): uma
  // lista de ids no `IN` esbarraria no teto de parâmetros do Postgres
  if (doGrupo) customers = customers.filter((c) => doGrupo.has(c.id));

  if (filter.minSpent) {
    customers = customers.filter(
      (c) => c.orders.reduce((s, v) => s + v.netTotal, 0) >= filter.minSpent!
    );
  }

  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    city: c.city,
    totalSpent: c.orders.reduce((s, v) => s + v.netTotal, 0),
  }));
}
