import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { evaluateSegment, type SegmentFilter } from "@/lib/segments";

/**
 * Público de uma campanha + progresso do disparo.
 * GET  → lista os clientes do alvo com telefone e se já receberam.
 * POST → marca um cliente como "mensagem enviada" (idempotente); quando
 *        todos receberem, a campanha vira CONCLUÍDA sozinha.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const campaign = await db.campaign.findFirst({
      where: { id, companyId: user.companyId },
      include: { sends: { select: { customerId: true } } },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    const filter = JSON.parse(campaign.filterJson || "{}") as SegmentFilter;
    const customers = await evaluateSegment(user, filter);
    const sent = new Set(campaign.sends.map((s) => s.customerId));
    return NextResponse.json({
      message: campaign.message,
      status: campaign.status,
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        sent: sent.has(c.id),
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

const postSchema = z.object({ customerId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const campaign = await db.campaign.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
    }
    await db.campaignSend.upsert({
      where: {
        campaignId_customerId: {
          campaignId: id,
          customerId: parsed.data.customerId,
        },
      },
      create: { campaignId: id, customerId: parsed.data.customerId },
      update: {},
    });
    // registra o contato na timeline do cliente (alimenta "sem contato")
    await db.customer.updateMany({
      where: { id: parsed.data.customerId, companyId: user.companyId },
      data: { lastContactAt: new Date() },
    });

    // todos receberam? campanha concluída
    const filter = JSON.parse(campaign.filterJson || "{}") as SegmentFilter;
    const [audience, sends] = await Promise.all([
      evaluateSegment(user, filter),
      db.campaignSend.count({ where: { campaignId: id } }),
    ]);
    if (audience.length > 0 && sends >= audience.length) {
      await db.campaign.update({
        where: { id },
        data: { status: "CONCLUIDA" },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
