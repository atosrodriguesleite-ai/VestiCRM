import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { receiveMessage, updateDeliveryStatus } from "@/lib/comm/engine";

/**
 * Webhook do WhatsApp — Communication Engine.
 *
 * GET  → verificação da Meta (hub.challenge) usando o Verify Token salvo em
 *        Configurações → Comunicação. Já funciona no padrão oficial.
 * POST → mensagens recebidas e recibos de status. Hoje aceita o formato
 *        simulado; quando a Cloud API for ligada, basta mapear o payload
 *        `entry[].changes[].value` para as mesmas chamadas da engine.
 */

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  // compara com o verify token de qualquer empresa configurada
  const all = await db.commSettings.findMany({
    where: { verifyToken: { not: null } },
  });
  const match = all.some((s) => decryptSecret(s.verifyToken!) === token);
  if (!match) {
    return NextResponse.json({ error: "Verify token inválido" }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

const messageSchema = z.object({
  company: z.string().min(1),
  phone: z.string().min(8),
  name: z.string().optional(),
  text: z.string().min(1),
  mediaType: z
    .enum(["TEXT", "IMAGE", "AUDIO", "DOCUMENT", "VIDEO"])
    .optional(),
  mediaUrl: z.string().optional(),
  fileName: z.string().optional(),
  externalId: z.string().optional(),
});

const statusSchema = z.object({
  company: z.string().min(1),
  statusUpdate: z.object({
    externalId: z.string().min(1),
    status: z.enum(["ENTREGUE", "LIDA", "FALHOU"]),
    error: z.string().optional(),
  }),
});

export async function POST(req: NextRequest) {
  const secret = process.env.INTAKE_SECRET;
  if (secret && req.headers.get("x-intake-token") !== secret) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  // recibo de status (entregue/lida/falhou)
  const statusParsed = statusSchema.safeParse(body);
  if (statusParsed.success) {
    const company = await db.company.findUnique({
      where: { slug: statusParsed.data.company },
    });
    if (!company) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }
    const updated = await updateDeliveryStatus(
      company.id,
      statusParsed.data.statusUpdate.externalId,
      statusParsed.data.statusUpdate.status,
      statusParsed.data.statusUpdate.error
    );
    return NextResponse.json({ ok: true, updated: Boolean(updated) });
  }

  // mensagem recebida
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const company = await db.company.findUnique({
    where: { slug: parsed.data.company },
  });
  if (!company) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }

  const result = await receiveMessage(company.id, {
    channel: "WHATSAPP",
    phone: parsed.data.phone,
    name: parsed.data.name,
    text: parsed.data.text,
    mediaType: parsed.data.mediaType,
    mediaUrl: parsed.data.mediaUrl,
    fileName: parsed.data.fileName,
    externalId: parsed.data.externalId,
  });

  return NextResponse.json({
    ok: true,
    isNewLead: result.isNewLead,
    conversationId: result.conversation?.id,
  });
}
