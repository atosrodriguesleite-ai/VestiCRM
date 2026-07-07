import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isManagerUp } from "@/lib/scope";
import { receiveMessage, sendMessage, updateDeliveryStatus } from "@/lib/comm/engine";

/**
 * Simulador da Communication Engine — exercita todos os fluxos sem
 * nenhuma integração real: mensagem recebida (texto/imagem/áudio/documento),
 * envio, erro de envio, recibos de entrega/leitura e erro de webhook.
 */

const schema = z.object({
  scenario: z.enum([
    "received_text",
    "received_image",
    "received_audio",
    "received_document",
    "sent_ok",
    "sent_fail",
    "status_delivered",
    "status_read",
    "webhook_error",
  ]),
});

const DEMO_PHONE = "5511900001234";
const DEMO_IMAGE = "/products/vestido-rosa.svg";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isManagerUp(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Cenário inválido" }, { status: 400 });
    }
    const companyId = user.companyId;

    switch (parsed.data.scenario) {
      case "received_text": {
        const r = await receiveMessage(companyId, {
          channel: "WHATSAPP",
          phone: DEMO_PHONE,
          name: "Cliente Simulado",
          text: "Oi! Essa é uma mensagem simulada de cliente 📱",
          externalId: `wamid.sim.${Date.now()}`,
        });
        return NextResponse.json({ ok: true, conversationId: r.conversation?.id });
      }
      case "received_image": {
        const r = await receiveMessage(companyId, {
          channel: "WHATSAPP",
          phone: DEMO_PHONE,
          name: "Cliente Simulado",
          text: "📷 Foto",
          mediaType: "IMAGE",
          mediaUrl: DEMO_IMAGE,
          externalId: `wamid.sim.${Date.now()}`,
        });
        return NextResponse.json({ ok: true, conversationId: r.conversation?.id });
      }
      case "received_audio": {
        const r = await receiveMessage(companyId, {
          channel: "WHATSAPP",
          phone: DEMO_PHONE,
          name: "Cliente Simulado",
          text: "🎤 Áudio (0:12)",
          mediaType: "AUDIO",
          externalId: `wamid.sim.${Date.now()}`,
        });
        return NextResponse.json({ ok: true, conversationId: r.conversation?.id });
      }
      case "received_document": {
        const r = await receiveMessage(companyId, {
          channel: "WHATSAPP",
          phone: DEMO_PHONE,
          name: "Cliente Simulado",
          text: "📎 Documento",
          mediaType: "DOCUMENT",
          fileName: "tabela-medidas.pdf",
          externalId: `wamid.sim.${Date.now()}`,
        });
        return NextResponse.json({ ok: true, conversationId: r.conversation?.id });
      }
      case "sent_ok":
      case "sent_fail": {
        const conv = await db.conversation.findFirst({
          where: { companyId, customer: { phone: DEMO_PHONE } },
          orderBy: { lastMessageAt: "desc" },
        });
        if (!conv) {
          return NextResponse.json(
            { error: "Simule primeiro uma mensagem recebida" },
            { status: 400 }
          );
        }
        const message = await sendMessage({
          conversationId: conv.id,
          companyId,
          body:
            parsed.data.scenario === "sent_fail"
              ? "Mensagem de teste [simular-falha]"
              : "Resposta simulada da loja ✅",
          authorId: user.id,
        });
        return NextResponse.json({ ok: true, status: message.status, error: message.error });
      }
      case "status_delivered":
      case "status_read": {
        const message = await db.message.findFirst({
          where: {
            conversation: { companyId },
            direction: "OUT",
            externalId: { not: null },
            status: { in: ["ENVIADA", "ENTREGUE", "REENVIADA"] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (!message?.externalId) {
          return NextResponse.json(
            { error: "Nenhuma mensagem enviada para receber o recibo" },
            { status: 400 }
          );
        }
        const updated = await updateDeliveryStatus(
          companyId,
          message.externalId,
          parsed.data.scenario === "status_read" ? "LIDA" : "ENTREGUE"
        );
        return NextResponse.json({ ok: true, status: updated?.status });
      }
      case "webhook_error": {
        await db.commEvent.create({
          data: {
            companyId,
            channel: "WHATSAPP",
            direction: "IN",
            type: "webhook.error",
            status: "ERRO",
            payload: JSON.stringify({ raw: "{ payload inválido…" }),
            error: "Assinatura X-Hub-Signature-256 inválida (simulado)",
            durationMs: 4,
            attempts: 3,
          },
        });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
