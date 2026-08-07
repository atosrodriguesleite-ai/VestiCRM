import { db } from "./db";

/**
 * JORNADA DA BIO — o que a bio levou pro catálogo, com a conta honesta.
 *
 * Auditoria 06/08/2026: "Montaram sacola" contava SESSÕES — a mesma cliente
 * em 3 visitas com a mesma sacola de R$ 400 virava "3 montaram / R$ 1.200".
 * Regra única (a mesma dos carrinhos abandonados da Inteligência): 1 pessoa
 * = 1 sacola, valendo a sessão mais RECENTE dela.
 */
export async function jornadaDaBio(companyId: string, from?: Date | null) {
  const [catalogVisits, sessoes] = await Promise.all([
    db.trackSession.count({
      where: {
        companyId,
        utmSource: "bio",
        ...(from ? { startedAt: { gte: from } } : {}),
      },
    }),
    db.trackSession.findMany({
      where: {
        companyId,
        utmSource: "bio",
        cartValue: { gt: 0 },
        ...(from ? { startedAt: { gte: from } } : {}),
      },
      select: { visitorId: true, cartValue: true },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const vistos = new Set<string>();
  let bags = 0;
  let bagsValue = 0;
  for (const s of sessoes) {
    if (vistos.has(s.visitorId)) continue;
    vistos.add(s.visitorId);
    bags += 1;
    bagsValue += s.cartValue;
  }
  return { catalogVisits, bags, bagsValue: Math.round(bagsValue * 100) / 100 };
}
