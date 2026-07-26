import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receiveMessage, updateDeliveryStatus } from "@/lib/comm/engine";
import { jidToPhone, evoGetMediaBase64 } from "@/lib/comm/evolution";
import { phoneMatchVariants } from "@/lib/intake";
import { alertWhatsappDown } from "@/lib/health";
import type { MessageMedia } from "@prisma/client";

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
    imageMessage?: { caption?: string; mimetype?: string };
    videoMessage?: { caption?: string; mimetype?: string };
    documentMessage?: { fileName?: string; mimetype?: string };
    audioMessage?: { mimetype?: string };
    stickerMessage?: { mimetype?: string };
    // apagar "para todos" chega como protocolMessage tipo REVOKE
    protocolMessage?: { type?: string; key?: { id?: string } };
    // texto editado chega como editedMessage
    editedMessage?: {
      message?: { conversation?: string; extendedTextMessage?: { text?: string } };
    };
  };
  status?: string;
};

type Extracted = {
  text: string;
  mediaType: MessageMedia;
  mimeFallback: string | null;
  fileName: string | null;
};

function extractText(m: EvoMessage): Extracted {
  const msg = m.message ?? {};
  if (msg.conversation)
    return { text: msg.conversation, mediaType: "TEXT", mimeFallback: null, fileName: null };
  if (msg.extendedTextMessage?.text)
    return { text: msg.extendedTextMessage.text, mediaType: "TEXT", mimeFallback: null, fileName: null };
  if (msg.imageMessage)
    return { text: msg.imageMessage.caption || "[foto]", mediaType: "IMAGE", mimeFallback: msg.imageMessage.mimetype ?? "image/jpeg", fileName: null };
  if (msg.videoMessage)
    return { text: msg.videoMessage.caption || "[vídeo]", mediaType: "VIDEO", mimeFallback: msg.videoMessage.mimetype ?? "video/mp4", fileName: null };
  if (msg.audioMessage)
    return { text: "[áudio]", mediaType: "AUDIO", mimeFallback: msg.audioMessage.mimetype ?? "audio/ogg", fileName: null };
  if (msg.documentMessage)
    return {
      text: `[arquivo] ${msg.documentMessage.fileName ?? ""}`.trim(),
      mediaType: "DOCUMENT",
      mimeFallback: msg.documentMessage.mimetype ?? "application/octet-stream",
      fileName: msg.documentMessage.fileName ?? null,
    };
  if (msg.stickerMessage)
    return { text: "[figurinha]", mediaType: "IMAGE", mimeFallback: msg.stickerMessage.mimetype ?? "image/webp", fileName: null };
  return { text: "", mediaType: "TEXT", mimeFallback: null, fileName: null };
}

// teto de segurança do arquivo salvo na conversa (~12 MB em base64)
const MEDIA_BASE64_MAX = 12 * 1024 * 1024;

/** Busca o arquivo da mensagem no servidor Evolution e monta a data URL. */
async function fetchMediaDataUrl(
  instance: string | null,
  messageId: string | undefined,
  mimeFallback: string | null
): Promise<string | null> {
  if (!instance || !messageId) return null;
  const res = await evoGetMediaBase64(instance, messageId);
  const b64 = res.data?.base64;
  if (!res.ok || !b64 || b64.length > MEDIA_BASE64_MAX) return null;
  const mime = res.data?.mimetype || mimeFallback || "application/octet-stream";
  return `data:${mime.split(";")[0]};base64,${b64}`;
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
                  evolutionDownSince: null,
                  evolutionAlertAt: null,
                  ...(d?.wuid ? { evolutionPhone: jidToPhone(d.wuid) } : {}),
                }
              : {}),
          },
        });
        // ESTAVA conectado e caiu → avisa a loja NA HORA (sino + push).
        // "close" durante a leitura do QR não conta (não estava conectado).
        if (state === "close" && settings.evolutionStatus === "CONECTADO") {
          await db.commSettings.update({
            where: { companyId },
            data: { evolutionDownSince: new Date() },
          });
          await alertWhatsappDown(companyId).catch(() => {});
        }
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
        if (!phone) continue;

        // o cliente apagou uma mensagem (REVOKE): marca a mensagem alvo como
        // "apagada pelo cliente" mas MANTÉM o conteúdo (a loja ainda lê)
        const proto = m.message?.protocolMessage;
        if (proto?.type === "REVOKE" && proto.key?.id) {
          await db.message.updateMany({
            where: { externalId: proto.key.id, conversation: { companyId } },
            data: { revoked: true, revokedBy: "CUSTOMER" },
          });
          continue;
        }

        // o cliente editou uma mensagem: atualiza o texto e marca "editada"
        const edited = m.message?.editedMessage?.message;
        const editedText =
          edited?.conversation ?? edited?.extendedTextMessage?.text ?? null;
        if (editedText && m.key?.id) {
          await db.message.updateMany({
            where: { externalId: m.key.id, conversation: { companyId } },
            data: { body: editedText, editedAt: new Date() },
          });
          continue;
        }

        const { text, mediaType, mimeFallback, fileName } = extractText(m);
        if (!text) continue;

        // foto/áudio/vídeo/arquivo: baixa o conteúdo para exibir na conversa
        const mediaUrl =
          mediaType === "TEXT"
            ? null
            : await fetchMediaDataUrl(settings.evolutionInstance, m.key?.id, mimeFallback);

        if (!m.key?.fromMe) {
          // mensagem do CLIENTE → central de leads (funil, vendedor, tarefa)
          await receiveMessage(companyId, {
            channel: "WHATSAPP",
            phone,
            name: m.pushName || undefined,
            text,
            ...(mediaType !== "TEXT" && mediaUrl
              ? { mediaType, mediaUrl, fileName: fileName ?? undefined }
              : {}),
            externalId: m.key?.id,
          });
        } else {
          // mensagem enviada PELO CELULAR da loja → registra na conversa do
          // cliente (histórico completo), sem reenviar nada. Dedup tolerante
          // ao 9º dígito para casar com o mesmo cadastro do intake.
          const customer = await db.customer.findFirst({
            where: { companyId, phone: { in: phoneMatchVariants(phone) } },
            orderBy: { createdAt: "asc" },
          });
          if (!customer) continue;
          let conv = await db.conversation.findFirst({
            where: { companyId, customerId: customer.id, status: { not: "CLOSED" } },
            orderBy: { lastMessageAt: "desc" },
          });
          if (!conv) {
            // histórico é sagrado: reabre a conversa encerrada mais recente
            // (mantém todo o histórico) em vez de nascer um chat vazio
            const encerrada = await db.conversation.findFirst({
              where: { companyId, customerId: customer.id, status: "CLOSED" },
              orderBy: { lastMessageAt: "desc" },
            });
            conv = encerrada
              ? await db.conversation.update({
                  where: { id: encerrada.id },
                  data: { status: "OPEN" },
                })
              : await db.conversation.create({
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
                ...(mediaType !== "TEXT" && mediaUrl
                  ? { mediaType, mediaUrl, fileName }
                  : {}),
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

    // o cliente apagou uma mensagem (evento dedicado do servidor)
    if (event === "messages.delete") {
      const raw = body.data as
        | { id?: string; keyId?: string; key?: { id?: string } }
        | { id?: string; keyId?: string; key?: { id?: string } }[];
      const list = Array.isArray(raw) ? raw : [raw];
      let matched = 0;
      for (const d of list) {
        const msgId = d?.key?.id ?? d?.id ?? d?.keyId;
        if (!msgId) continue;
        const r = await db.message.updateMany({
          where: { externalId: msgId, conversation: { companyId } },
          data: { revoked: true, revokedBy: "CUSTOMER" },
        });
        matched += r.count;
      }
      // diagnóstico (aparece na Central de Comunicação): confirma que o evento
      // chegou e se casou com alguma mensagem
      await db.commEvent
        .create({
          data: {
            companyId,
            channel: "WHATSAPP",
            direction: "IN",
            type: "wa.cliente.apagou",
            status: matched > 0 ? "OK" : "ERRO",
            payload: JSON.stringify(body.data).slice(0, 500),
            response: JSON.stringify({ marcadas: matched }),
          },
        })
        .catch(() => {});
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
