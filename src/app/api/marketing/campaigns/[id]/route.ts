import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { normalizaRefDigitada, refsDaCampanha } from "@/lib/ad-match";

/** Editar (renomear/ativar-desativar) ou apagar uma campanha de marketing. */

const schema = z.object({
  name: z.string().min(1).max(80).optional(),
  channel: z.enum(["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "TIKTOK", "OUTRO"]).optional(),
  active: z.boolean().optional(),
  // anúncios desta campanha (links ou códigos, um por linha)
  adRefs: z.string().max(4000).nullable().optional(),
  // vincular UM anúncio detectado: soma na lista e puxa o histórico dele
  vincularAdRef: z.string().max(200).optional(),
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
    const data: Record<string, unknown> = {
      ...(parsed.data.name != null ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.channel != null ? { channel: parsed.data.channel } : {}),
      ...(parsed.data.active != null ? { active: parsed.data.active } : {}),
      ...(parsed.data.adRefs !== undefined ? { adRefs: parsed.data.adRefs } : {}),
    };

    // Vincular um anúncio JÁ DETECTADO a esta campanha: acrescenta o código na
    // lista e adota o histórico — as clientes que chegaram por esse anúncio e
    // ainda não tinham campanha passam a contar aqui.
    let adotados = 0;
    const novo = parsed.data.vincularAdRef
      ? normalizaRefDigitada(parsed.data.vincularAdRef)
      : null;
    if (novo) {
      const atual = await db.marketingCampaign.findUnique({
        where: { id },
        select: { adRefs: true },
      });
      const lista = refsDaCampanha(atual?.adRefs);
      if (!lista.includes(novo)) {
        data.adRefs = [...lista, novo].join("\n");
      }
      const r = await db.marketingCampaign.update({
        where: { id },
        data,
        select: { id: true },
      });
      const back = await db.customer.updateMany({
        where: { companyId: user.companyId, adRef: novo, campaignId: null },
        data: { campaignId: r.id },
      });
      adotados = back.count;
    }

    const campaign = await db.marketingCampaign.update({
      where: { id },
      data: novo ? {} : data,
      select: { id: true, name: true, channel: true, utmKey: true, active: true, adRefs: true },
    });
    return NextResponse.json({ ok: true, campaign, adotados });
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
