import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { intakeLead } from "@/lib/intake";

/**
 * Webhook de mensagens recebidas do WhatsApp.
 *
 * Hoje aceita o formato simulado abaixo; quando a WhatsApp Cloud API for
 * conectada, este endpoint recebe o webhook da Meta — basta mapear
 * entry[].changes[].value.messages[] para o mesmo intakeLead. A regra é
 * a do Lead Intake Engine: telefone conhecido reabre/atualiza a conversa
 * existente; desconhecido vira lead novo com origem WhatsApp.
 */

const schema = z.object({
  company: z.string().min(1), // slug da loja
  phone: z.string().min(8),
  name: z.string().optional(),
  text: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const secret = process.env.INTAKE_SECRET;
  if (secret && req.headers.get("x-intake-token") !== secret) {
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
    origin: "WHATSAPP",
    message: parsed.data.text,
  });

  return NextResponse.json({
    ok: true,
    isNewLead: result.isNewLead,
    conversationId: result.conversation?.id,
  });
}
