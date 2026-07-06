import { db } from "./db";
import type { SessionUser } from "./auth";
import type { CustomerType, Prisma } from "@prisma/client";

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
};

export async function evaluateSegment(user: SessionUser, filter: SegmentFilter) {
  const where: Prisma.CustomerWhereInput = { companyId: user.companyId };

  if (filter.inactiveDays) {
    const cutoff = new Date(
      Date.now() - filter.inactiveDays * 24 * 60 * 60 * 1000
    );
    where.OR = [{ lastPurchaseAt: { lt: cutoff } }, { lastPurchaseAt: null }];
  }
  if (filter.type) where.type = filter.type;
  if (filter.city) where.city = { contains: filter.city };
  if (filter.interest) {
    where.interests = { some: { interest: { name: filter.interest } } };
  }
  if (filter.tag) {
    where.tags = { some: { tag: { name: filter.tag } } };
  }
  if (filter.lostDeals) {
    where.opportunities = { some: { status: "LOST" } };
  }

  let customers = await db.customer.findMany({
    where,
    include: { sales: { select: { total: true } } },
    orderBy: { name: "asc" },
  });

  if (filter.minSpent) {
    customers = customers.filter(
      (c) => c.sales.reduce((s, v) => s + v.total, 0) >= filter.minSpent!
    );
  }

  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    city: c.city,
    totalSpent: c.sales.reduce((s, v) => s + v.total, 0),
  }));
}
