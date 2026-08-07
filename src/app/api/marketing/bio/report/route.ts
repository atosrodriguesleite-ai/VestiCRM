import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/**
 * Relatório da Bio por PERÍODO. `?days=N` → últimos N dias (usa os eventos com
 * data BioView/BioClick + TrackSession). Sem days (ou days=0) → tudo (usa os
 * contadores acumulados). Devolve sempre o mesmo formato pro relatório montar.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const companyId = user.companyId;
    const page = await db.bioPage.findUnique({
      where: { companyId },
      include: { links: { orderBy: { order: "asc" } } },
    });
    if (!page) return NextResponse.json({ error: "Sem bio" }, { status: 404 });

    const days = Math.max(0, Math.min(3650, Number(req.nextUrl.searchParams.get("days")) || 0));
    const from = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

    const linkTitle = new Map(page.links.map((l) => [l.id, l.title]));

    let visitas: number;
    let cliques: number;
    let topLinks: { id: string; title: string; clicks: number }[];
    let catalogVisits: number;
    let bags: number;
    let bagsValue: number;

    if (from) {
      // por período: usa os eventos com data
      const [views, clickGroups, cv, bg, bgAgg] = await Promise.all([
        db.bioView.count({ where: { bioPageId: page.id, createdAt: { gte: from } } }),
        db.bioClick.groupBy({
          by: ["bioLinkId"],
          where: { bioPageId: page.id, createdAt: { gte: from } },
          _count: { _all: true },
        }),
        db.trackSession.count({ where: { companyId, utmSource: "bio", startedAt: { gte: from } } }),
        db.trackSession.count({
          where: { companyId, utmSource: "bio", cartValue: { gt: 0 }, startedAt: { gte: from } },
        }),
        db.trackSession.aggregate({
          where: { companyId, utmSource: "bio", cartValue: { gt: 0 }, startedAt: { gte: from } },
          _sum: { cartValue: true },
        }),
      ]);
      visitas = views;
      cliques = clickGroups.reduce((s, g) => s + g._count._all, 0);
      topLinks = clickGroups
        .map((g) => ({ id: g.bioLinkId, title: linkTitle.get(g.bioLinkId) ?? "—", clicks: g._count._all }))
        .filter((l) => l.clicks > 0)
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 4);
      catalogVisits = cv;
      bags = bg;
      bagsValue = bgAgg._sum.cartValue ?? 0;
    } else {
      // tudo: usa os contadores acumulados
      const [cv, bg, bgAgg] = await Promise.all([
        db.trackSession.count({ where: { companyId, utmSource: "bio" } }),
        db.trackSession.count({ where: { companyId, utmSource: "bio", cartValue: { gt: 0 } } }),
        db.trackSession.aggregate({
          where: { companyId, utmSource: "bio", cartValue: { gt: 0 } },
          _sum: { cartValue: true },
        }),
      ]);
      visitas = page.views;
      cliques = page.links.reduce((s, l) => s + l.clicks, 0);
      topLinks = page.links
        .filter((l) => l.clicks > 0)
        .map((l) => ({ id: l.id, title: l.title, clicks: l.clicks }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 4);
      catalogVisits = cv;
      bags = bg;
      bagsValue = bgAgg._sum.cartValue ?? 0;
    }

    // MÉDIA de cliques por visita (não é % — a mesma pessoa clica em vários
    // botões, então o antigo "103%" era normal e parecia bug)
    const ctr = visitas > 0 ? cliques / visitas : 0;
    return NextResponse.json({
      visitas,
      cliques,
      ctr,
      topLinks,
      journey: { catalogVisits, bags, bagsValue },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
