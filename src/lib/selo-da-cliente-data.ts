import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { conversationScope } from "./scope";
import type { SessionUser } from "./auth";
import { contarPedidos, infoDoSelo, type SeloInfo } from "./selo-da-cliente";

/** o que a rota do sync devolve por cliente */
export type SeloMexido = SeloInfo & { customerId: string };

/**
 * A CONSULTA do selo (RN-063): UMA ida ao banco para a lista inteira —
 * pedidos agrupados por cliente × status, só dos clientes da página e só da
 * loja (RN-013). Cancelado fica fora já na consulta. Pelo índice
 * (companyId, customerId), migração 20260921100100 — sem ele o Postgres caía
 * no (companyId, status) e varria todo pedido da loja a cada abertura da
 * Central (achado da revisão).
 */
export async function selosDosClientes(
  companyId: string,
  customerIds: string[]
): Promise<Map<string, SeloInfo>> {
  const ids = [...new Set(customerIds)];
  const por = new Map<string, SeloInfo>();
  if (ids.length === 0) return por;
  const linhas = await db.order.groupBy({
    by: ["customerId", "status"],
    where: { companyId, customerId: { in: ids }, status: { not: "CANCELADO" } },
    _count: { _all: true },
  });
  const contagem = contarPedidos(
    linhas.map((l) => ({ customerId: l.customerId, status: l.status, n: l._count._all }))
  );
  for (const id of ids) por.set(id, infoDoSelo(contagem.get(id)));
  return por;
}

/** teto de clientes recalculados por batida do sync (ver abaixo) */
export const TETO_SELOS_POR_SYNC = 500;

/**
 * QUEM TEVE PEDIDO MEXIDO desde a última batida do sync — é o que faz o selo
 * trocar SOZINHO na tela aberta, sem carimbo em nenhum caminho de pedido:
 * todo pedido criado ou que mudou de status tem `updatedAt` novo, e o sync
 * devolve o selo fresco desses clientes. Índice (companyId, updatedAt),
 * migração 20260921100000.
 *
 * Dois cuidados que a revisão pediu: (1) o DISTINCT é feito no BANCO
 * (`groupBy` por cliente): `distinct` + `take` do Prisma corta as LINHAS de
 * pedido antes de deduplicar, e uma sync da Nuvemshop com 600 pedidos
 * devolvia um punhado de clientes ao acaso; (2) o recorte de QUEM VÊ
 * (`conversationScope`, RN-013): a vendedora que só vê as conversas dela não
 * recebe contagem de pedido de cliente que não está no recorte dela —
 * cliente sem conversa no recorte simplesmente não volta.
 *
 * Pedido APAGADO ou TRANSFERIDO de cliente não deixa `updatedAt` na cliente
 * antiga — por isso essas duas portas tocam as conversas dela
 * (`tocarConversasDaCliente`), e elas voltam pelo sync normal.
 */
export async function selosMexidosDesde(
  user: SessionUser,
  since: Date
): Promise<SeloMexido[]> {
  const mexidos = await db.order.groupBy({
    by: ["customerId"],
    where: { companyId: user.companyId, updatedAt: { gt: since } },
    // teto de segurança: uma importação em massa não pode virar um pacote
    // gigante no sync; o que passar do teto acerta na recarga completa
    take: TETO_SELOS_POR_SYNC,
    orderBy: { customerId: "asc" },
  });
  if (mexidos.length === 0) return [];
  // só as clientes com conversa no recorte de quem está olhando
  const noRecorte = await db.conversation.findMany({
    where: { ...conversationScope(user), customerId: { in: mexidos.map((m) => m.customerId) } },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  if (noRecorte.length === 0) return [];
  const selos = await selosDosClientes(
    user.companyId,
    noRecorte.map((c) => c.customerId)
  );
  return [...selos.entries()].map(([customerId, info]) => ({ customerId, ...info }));
}

/**
 * Toca as conversas de UMA cliente (só o `updatedAt`, que é o que o sync da
 * inbox lê) para a tela aberta receber o selo fresco em segundos. Usado
 * pelas portas em que o pedido some da cliente sem deixar `updatedAt` nela:
 * apagar o pedido e transferi-lo para outra cliente.
 */
export async function tocarConversasDaCliente(
  tx: Prisma.TransactionClient | typeof db,
  companyId: string,
  customerId: string
): Promise<void> {
  await tx.conversation.updateMany({
    where: { companyId, customerId },
    data: { updatedAt: new Date() },
  });
}
