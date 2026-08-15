import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isSupport } from "@/lib/scope";
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
    // Suporte não mexe em campanhas (a tela já bloqueia; a API aceitava e
    // devolvia a lista de telefones da loja inteira — auditoria 07/08/2026).
    if (isSupport(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
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
    if (isSupport(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
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
    // o cliente marcado tem que ser DESTA loja (CampaignSend não tem
    // companyId; sem isto dava para amarrar id de outra loja — auditoria)
    const cliente = await db.customer.findFirst({
      where: { id: parsed.data.customerId, companyId: user.companyId },
      select: { id: true },
    });
    if (!cliente) {
      return NextResponse.json({ error: "Cliente inválido" }, { status: 404 });
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

    // todos receberam? campanha concluída. O público é DINÂMICO (o filtro
    // roda de novo a cada consulta), então a conta certa é a INTERSEÇÃO:
    // quantos do público ATUAL já receberam — não o total bruto de envios
    // (que pode incluir gente que saiu do filtro e mascarar pendentes).
    const filter = JSON.parse(campaign.filterJson || "{}") as SegmentFilter;
    const [audience, sends] = await Promise.all([
      evaluateSegment(user, filter),
      db.campaignSend.findMany({
        where: { campaignId: id },
        select: { customerId: true },
      }),
    ]);
    const sentSet = new Set(sends.map((s) => s.customerId));
    const cobertos = audience.filter((a) => sentSet.has(a.id)).length;
    if (audience.length > 0 && cobertos >= audience.length) {
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
