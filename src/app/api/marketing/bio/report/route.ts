import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { jornadaDaBio } from "@/lib/bio-jornada";
import { periodFromDays } from "@/lib/tracking/insights";

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
    // "Hoje" é o DIA de São Paulo, não as últimas 24h corridas — mesma régua
    // do resto do módulo (periodFromDays): às 9h da manhã, "hoje" com a noite
    // de ontem inteira não batia com nenhum outro número da tela.
    const from =
      days === 1
        ? periodFromDays(1).from
        : days > 0
          ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
          : null;

    const linkTitle = new Map(page.links.map((l) => [l.id, l.title]));

    // jornada com a conta honesta: 1 pessoa = 1 sacola (a mais recente)
    const journey = await jornadaDaBio(companyId, from);
    // UMA fonte só, com e sem filtro: os EVENTOS com data. O "Tudo" somava os
    // contadores dos botões VIVOS — apagar um botão fazia o "Tudo" ficar
    // MENOR que o "7 dias" (os cliques do botão apagado só existiam nos
    // eventos). Clique de botão apagado continua contando, com o nome dele.
    const [views, clickGroups] = await Promise.all([
      db.bioView.count({
        where: { bioPageId: page.id, ...(from ? { createdAt: { gte: from } } : {}) },
      }),
      db.bioClick.groupBy({
        by: ["bioLinkId"],
        where: { bioPageId: page.id, ...(from ? { createdAt: { gte: from } } : {}) },
        _count: { _all: true },
      }),
    ]);
    // os primeiros 2 dias da Bio (jul/2026) só existem nos contadores antigos
    // — no "Tudo", vale o MAIOR dos dois POR BOTÃO, e o total é a soma das
    // mesmas linhas do ranking (número e lista sempre fecham)
    const visitas = from ? views : Math.max(views, page.views);
    const eventosPorLink = new Map(clickGroups.map((g) => [g.bioLinkId, g._count._all]));
    const linhas = from
      ? clickGroups.map((g) => ({
          id: g.bioLinkId,
          title: linkTitle.get(g.bioLinkId) ?? "Botão apagado",
          clicks: g._count._all,
        }))
      : [
          ...page.links.map((l) => ({
            id: l.id,
            title: l.title,
            clicks: Math.max(l.clicks, eventosPorLink.get(l.id) ?? 0),
          })),
          // botão apagado: só os eventos sabem dele
          ...clickGroups
            .filter((g) => !linkTitle.has(g.bioLinkId))
            .map((g) => ({ id: g.bioLinkId, title: "Botão apagado", clicks: g._count._all })),
        ];
    const cliques = linhas.reduce((s, l) => s + l.clicks, 0);
    const topLinks = linhas
      .filter((l) => l.clicks > 0)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 4);
    const { catalogVisits, bags, bagsValue } = journey;

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
