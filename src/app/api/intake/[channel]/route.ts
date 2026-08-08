import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { intakeLead } from "@/lib/intake";
import type { Origin } from "@prisma/client";

/**
 * Webhook unificado de entrada de leads: POST /api/intake/{canal}
 *
 * Canais aceitos e origem atribuída:
 *   whatsapp → WHATSAPP          catalogo → CATALOGO_PUBLICO
 *   instagram → INSTAGRAM        facebook → FACEBOOK
 *   site → SITE                  nuvemshop → NUVEMSHOP
 *   bling → BLING                marketplace → MARKETPLACE
 *   google → GOOGLE
 *
 * Toda integração futura (Meta, Nuvemshop, Bling...) aponta o webhook
 * para cá — nenhuma cria clientes diretamente. Em produção, proteja com
 * INTAKE_SECRET (enviado no header x-intake-token) e/ou a assinatura do
 * provedor (ex.: X-Hub-Signature-256 da Meta).
 */

const CHANNEL_ORIGIN: Record<string, Origin> = {
  whatsapp: "WHATSAPP",
  catalogo: "CATALOGO_PUBLICO",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  site: "SITE",
  nuvemshop: "NUVEMSHOP",
  bling: "BLING",
  marketplace: "MARKETPLACE",
  google: "GOOGLE",
};

const schema = z.object({
  company: z.string().min(1), // slug da loja
  phone: z.string().min(8),
  name: z.string().optional(),
  message: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  title: z.string().optional(),
  value: z.number().nonnegative().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channel: string }> }
) {
  const { channel } = await params;
  const origin = CHANNEL_ORIGIN[channel.toLowerCase()];
  if (!origin) {
    return NextResponse.json({ error: "Canal desconhecido" }, { status: 404 });
  }

  // FAIL-CLOSED (auditoria 07/08/2026): sem INTAKE_SECRET configurado a rota
  // ficava ABERTA — qualquer um criava lead/conversa/oportunidade em qualquer
  // loja sabendo só o slug público. Sem a env, a porta fica FECHADA.
  const secret = process.env.INTAKE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Canal de entrada não configurado." },
      { status: 503 }
    );
  }
  if (req.headers.get("x-intake-token") !== secret) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const company = await db.company.findUnique({
    where: { slug: parsed.data.company },
  });
  if (!company) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }

  const result = await intakeLead(company.id, {
    phone: parsed.data.phone,
    name: parsed.data.name,
    origin,
    message: parsed.data.message,
    city: parsed.data.city,
    state: parsed.data.state,
    opportunityTitle: parsed.data.title,
    value: parsed.data.value,
  });

  return NextResponse.json(
    {
      ok: true,
      isNewLead: result.isNewLead,
      customerId: result.customer.id,
      conversationId: result.conversation?.id ?? null,
      opportunityId: result.opportunity?.id ?? null,
    },
    { status: result.isNewLead ? 201 : 200 }
  );
}
