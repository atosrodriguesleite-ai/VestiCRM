import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ehRobo } from "@/lib/robo";
import { resolveBioTarget, type BioLinkKind } from "@/lib/bio";

/**
 * Redirecionador de cliques da bio: conta o clique do botão e leva o
 * visitante ao destino real (catálogo, WhatsApp, site ou link externo).
 * Rota pública — só precisa do id do botão.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = new URL("/", req.url);

  const link = await db.bioLink.findUnique({
    where: { id },
    include: {
      bioPage: {
        select: {
          published: true,
          company: { select: { slug: true, whatsapp: true } },
        },
      },
    },
  });

  if (!link || !link.active || !link.bioPage.published) {
    return NextResponse.redirect(home);
  }

  const target = resolveBioTarget(
    { type: link.type as BioLinkKind, url: link.url },
    { slug: link.bioPage.company.slug, whatsapp: link.bioPage.company.whatsapp }
  );

  // conta o clique — mas SÓ de gente de verdade. A visita já filtrava robô
  // e o clique não: o Google seguia os botões da bio e o "cliques por
  // visita" inflava pelo numerador (auditoria 06/08/2026). Robô é só
  // redirecionado, sem contar.
  if (!ehRobo(req.headers.get("user-agent"))) {
    // total acumulado + evento com data (relatório por período)
    await Promise.all([
      db.bioLink.update({ where: { id }, data: { clicks: { increment: 1 } } }),
      db.bioClick.create({
        data: { bioLinkId: link.id, bioPageId: link.bioPageId, companyId: link.companyId },
      }),
    ]).catch(() => {});
  }

  return NextResponse.redirect(target ? new URL(target, req.url) : home);
}
