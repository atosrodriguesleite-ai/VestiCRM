import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receiveMessage, updateDeliveryStatus } from "@/lib/comm/engine";
import { jidToPhone } from "@/lib/comm/evolution";

/**
 * Webhook do WhatsApp sem API oficial (Evolution → plataforma).
 * O token da URL identifica e autentica a loja (único por conexão).
 *
 * Eventos tratados:
 *  - connection.update  → estado da conexão (conectado/caiu) na hora
 *  - messages.upsert    → mensagem RECEBIDA vira lead/conversa no funil
 *                         (Lead Intake: deduplicação, vendedor, tarefa, SLA);
 *                         mensagem enviada PELO CELULAR também entra no
 *                         histórico da conversa (visão completa do cliente)
 *  - messages.update    → recibos de entrega/leitura nas mensagens enviadas
 *
 * Sempre responde 200 (evita tempestade de retentativas do servidor).
 */

export const maxDuration = 30;

type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string };
type EvoMessage = {
  key?: EvoKey;
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { fileName?: string };
    audioMessage?: unknown;
    stickerMessage?: unknown;
  };
  status?: string;
};

function extractText(m: EvoMessage): { text: string; media: boolean } {
  const msg = m.message ?? {};
  if (msg.conversation) return { text: msg.conversation, media: false };
  if (msg.extendedTextMessage?.text)
    return { text: msg.extendedTextMessage.text, media: false };
  if (msg.imageMessage) return { text: msg.imageMessage.caption || "[foto]", media: true };
  if (msg.videoMessage) return { text: msg.videoMessage.caption || "[vídeo]", media: true };
  if (msg.audioMessage) return { text: "[áudio]", media: true };
  if (msg.documentMessage)
    return { text: `[arquivo] ${msg.documentMessage.fileName ?? ""}`.trim(), media: true };
  if (msg.stickerMessage) return { text: "[figurinha]", media: true };
  return { text: "", media: false };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const settings = await db.commSettings.findUnique({
    where: { evolutionWebhookToken: token },
  });
  if (!settings) return NextResponse.json({ ok: true }); // token desconhecido: ignora em silêncio

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    data?: unknown;
  } | null;
  if (!body?.event) return NextResponse.json({ ok: true });

  const companyId = settings.companyId;
  const event = body.event.toLowerCase().replace(/_/g, ".");

  try {
    if (event === "connection.update") {
      const d = body.data as { state?: string; wuid?: string } | undefined;
      const state = d?.state;
      if (state === "open" || state === "close" || state === "connecting") {
        await db.commSettings.update({
          where: { companyId },
          data: {
            evolutionStatus:
              state === "open"
                ? "CONECTADO"
                : state === "connecting"
                  ? "AGUARDANDO_QR"
                  : "DESCONECTADO",
            ...(state === "open"
              ? {
                  activeProvider: "EVOLUTION",
                  ...(d?.wuid ? { evolutionPhone: jidToPhone(d.wuid) } : {}),
                }
              : {}),
          },
        });
      }
    }

    if (event === "messages.upsert") {
      const raw = body.data as EvoMessage | EvoMessage[] | { messages?: EvoMessage[] };
      const list: EvoMessage[] = Array.isArray(raw)
        ? raw
        : (raw as { messages?: EvoMessage[] })?.messages ?? [raw as EvoMessage];

      for (const m of list) {
        const jid = m.key?.remoteJid ?? "";
        const phone = jidToPhone(jid); // grupos/status ficam de fora
        const { text } = extractText(m);
        if (!phone || !text) continue;

        if (!m.key?.fromMe) {
          // mensagem do CLIENTE → central de leads (funil, vendedor, tarefa)
          await receiveMessage(companyId, {
            channel: "WHATSAPP",
            phone,
            name: m.pushName || undefined,
            text,
            externalId: m.key?.id,
          });
        } else {
          // mensagem enviada PELO CELULAR da loja → registra na conversa do
          // cliente (histórico completo), sem reenviar nada
          const customer = await db.customer.findFirst({
            where: { companyId, phone: { endsWith: phone.slice(-11) } },
          });
          if (!customer) continue;
          let conv = await db.conversation.findFirst({
            where: { companyId, customerId: customer.id, status: { not: "CLOSED" } },
            orderBy: { lastMessageAt: "desc" },
          });
          if (!conv) {
            conv = await db.conversation.create({
              data: { companyId, customerId: customer.id, status: "OPEN" },
            });
          }
          const exists = m.key?.id
            ? await db.message.findFirst({
                where: { conversationId: conv.id, externalId: m.key.id },
              })
            : null;
          if (!exists) {
            await db.message.create({
              data: {
                conversationId: conv.id,
                channel: "WHATSAPP",
                direction: "OUT",
                body: text,
                externalId: m.key?.id,
                status: "ENVIADA",
              },
            });
            await db.conversation.update({
              where: { id: conv.id },
              data: { lastMessageAt: new Date(), lastOutboundAt: new Date() },
            });
          }
        }
      }
    }

    if (event === "messages.update") {
      const raw = body.data as
        | { keyId?: string; status?: string }
        | { keyId?: string; status?: string }[];
      const list = Array.isArray(raw) ? raw : [raw];
      for (const u of list) {
        if (!u?.keyId || !u.status) continue;
        const map: Record<string, "ENTREGUE" | "LIDA"> = {
          DELIVERY_ACK: "ENTREGUE",
          READ: "LIDA",
        };
        const status = map[u.status.toUpperCase()];
        if (status) await updateDeliveryStatus(companyId, u.keyId, status);
      }
    }
  } catch {
    // erros internos não devem derrubar o webhook — eventos seguintes continuam
  }

  return NextResponse.json({ ok: true });
}
