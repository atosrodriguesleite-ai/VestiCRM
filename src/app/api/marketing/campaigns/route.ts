import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { slugify } from "@/lib/provision";

/**
 * Campanhas de AQUISIÇÃO (módulo Marketing) — de onde os leads vêm.
 * GET: lista as campanhas da loja (para o seletor no "Lead + link" e a
 *      tela de gestão). Retorna vazio se o módulo estiver desativado.
 * POST: cria uma campanha (gerente/admin).
 */

const CHANNELS = ["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "TIKTOK", "OUTRO"] as const;

export async function GET() {
  try {
    const user = await requireUser();
    const company = await db.company.findUnique({
      where: { id: user.companyId },
      select: { marketingEnabled: true },
    });
    if (!company?.marketingEnabled) {
      return NextResponse.json({ enabled: false, campaigns: [] });
    }
    const campaigns = await db.marketingCampaign.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: { id: true, name: true, channel: true, utmKey: true, active: true },
    });
    return NextResponse.json({ enabled: true, campaigns });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const schema = z.object({
  name: z.string().min(1).max(80),
  channel: z.enum(CHANNELS).default("INSTAGRAM"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const company = await db.company.findUnique({
      where: { id: user.companyId },
      select: { marketingEnabled: true },
    });
    if (!company?.marketingEnabled) {
      return NextResponse.json({ error: "Módulo Marketing desativado." }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    // utmKey único por loja — deriva do nome e acrescenta sufixo se colidir
    const base = slugify(parsed.data.name);
    let utmKey = base;
    let n = 1;
    while (
      await db.marketingCampaign.findUnique({
        where: { companyId_utmKey: { companyId: user.companyId, utmKey } },
      })
    ) {
      n += 1;
      utmKey = `${base}-${n}`;
    }

    const campaign = await db.marketingCampaign.create({
      data: {
        companyId: user.companyId,
        name: parsed.data.name.trim(),
        channel: parsed.data.channel,
        utmKey,
      },
      select: { id: true, name: true, channel: true, utmKey: true, active: true },
    });
    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
