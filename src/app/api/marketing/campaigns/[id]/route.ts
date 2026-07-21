import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";

/** Editar (renomear/ativar-desativar) ou apagar uma campanha de marketing. */

const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  channel: z.enum(["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "TIKTOK", "OUTRO"]).optional(),
  active: z.boolean().optional(),
});

async function owned(companyId: string, id: string) {
  return db.marketingCampaign.findFirst({ where: { id, companyId }, select: { id: true } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    if (!(await owned(user.companyId, id))) {
      return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const data = {
      ...(parsed.data.name != null ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.channel != null ? { channel: parsed.data.channel } : {}),
      ...(parsed.data.active != null ? { active: parsed.data.active } : {}),
    };
    const campaign = await db.marketingCampaign.update({
      where: { id },
      data,
      select: { id: true, name: true, channel: true, utmKey: true, active: true },
    });
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { id } = await params;
    if (!(await owned(user.companyId, id))) {
      return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
    }
    // apagar não remove clientes: o campaignId deles fica nulo (onDelete: SetNull)
    await db.marketingCampaign.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
