import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receiveMessage, updateDeliveryStatus } from "@/lib/comm/engine";
import { jidToPhone, evoGetMediaBase64 } from "@/lib/comm/evolution";
import { findCustomerByPhone } from "@/lib/intake";
import { alertWhatsappDown } from "@/lib/health";
import { adCode, campanhaDoAnuncio } from "@/lib/ad-match";
import { formatPhone } from "@/lib/format";
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

// senderPn: quando o WhatsApp manda o contato com a identidade nova (@lid),
// o número de telefone REAL vem neste campo — sem ele a mensagem se perderia
type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string; senderPn?: string };
// Prévia do ANÚNCIO (Click-to-WhatsApp do Instagram/Facebook): quando o
// cliente chega clicando num anúncio, a primeira mensagem traz junto o
// título, o texto e o link do anúncio — informação de ouro pra atribuição.
type AdReply = {
  title?: string;
  body?: string;
  sourceUrl?: string;
  sourceId?: string;
  sourceType?: string;
};
type CtxInfo = { contextInfo?: { externalAdReply?: AdReply } };

type EvoMessage = {
  key?: EvoKey;
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string } & CtxInfo;
    imageMessage?: ({ caption?: string; mimetype?: string } & CtxInfo);
    videoMessage?: ({ caption?: string; mimetype?: string } & CtxInfo);
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

/**
 * Prévia do anúncio (se a mensagem veio de um clique em anúncio).
 *
 * O lugar do `externalAdReply` MUDA conforme o tipo de mensagem e a versão do
 * servidor: pode estar no texto, na foto, no vídeo, no botão, ou solto na
 * raiz. Em vez de adivinhar o caminho, procura em qualquer profundidade —
 * era por procurar em só três lugares que a prévia não aparecia.
 */
function extractAdReferral(m: EvoMessage): AdReply | null {
  let achado: AdReply | null = null;
  const visitados = new Set<unknown>();
  const procurar = (no: unknown, nivel: number) => {
    if (achado || !no || typeof no !== "object" || nivel > 6) return;
    if (visitados.has(no)) return;
    visitados.add(no);
    for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
      if (achado) return;
      if (chave === "externalAdReply" && valor && typeof valor === "object") {
        const ad = valor as AdReply;
        if (ad.title || ad.body || ad.sourceUrl || ad.sourceId) achado = ad;
        return;
      }
      if (valor && typeof valor === "object") procurar(valor, nivel + 1);
    }
  };
  procurar(m as unknown, 0);
  return achado;
}

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
        // grupos/status ficam de fora; contato @lid usa o número do senderPn
        let phone = jidToPhone(jid);
        if (!phone && jid.endsWith("@lid")) {
          const pn = (m.key?.senderPn ?? "").split("@")[0].replace(/\D/g, "");
          if (/^\d{8,15}$/.test(pn)) phone = pn;
        }
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
          const result = await receiveMessage(companyId, {
            channel: "WHATSAPP",
            phone,
            name: m.pushName || undefined,
            text,
            ...(mediaType !== "TEXT" && mediaUrl
              ? { mediaType, mediaUrl, fileName: fileName ?? undefined }
              : {}),
            externalId: m.key?.id,
          });

          // 📢 veio de um ANÚNCIO (Click-to-WhatsApp): registra a prévia como
          // nota no chat — a equipe vê de qual anúncio o cliente chegou e
          // consegue atribuir a conversa à campanha certa. Sem duplicar: a
          // mesma prévia só entra uma vez por conversa.
          const ad = extractAdReferral(m);
          // diagnóstico (Central de Comunicação): se o cliente é NOVO e não
          // veio prévia de anúncio, registra que tipos de conteúdo chegaram —
          // é assim que descobrimos se o servidor está mandando ou não
          if (!ad && result?.isNewLead) {
            await db.commEvent
              .create({
                data: {
                  companyId,
                  channel: "WHATSAPP",
                  direction: "IN",
                  type: "wa.anuncio.ausente",
                  status: "OK",
                  payload: JSON.stringify({
                    tipos: Object.keys(m.message ?? {}),
                    temContexto: JSON.stringify(m.message ?? {}).includes("contextInfo"),
                  }).slice(0, 300),
                },
              })
              .catch(() => {});
          }
          if (ad && result?.conversation) {
            const marcador = ad.sourceUrl || ad.title || ad.sourceId || "";
            const jaTem = marcador
              ? await db.message.findFirst({
                  where: {
                    conversationId: result.conversation.id,
                    kind: "NOTE",
                    body: { contains: marcador },
                  },
                  select: { id: true },
                })
              : null;
            if (!jaTem) {
              await db.message.create({
                data: {
                  conversationId: result.conversation.id,
                  direction: "IN",
                  kind: "NOTE",
                  body: [
                    "📢 Cliente veio de um ANÚNCIO",
                    ad.title ? `“${ad.title}”` : null,
                    ad.body ? ad.body.slice(0, 200) : null,
                    ad.sourceUrl ?? null,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              });
              await db.conversation.update({
                where: { id: result.conversation.id },
                data: { lastMessageAt: new Date() },
              });
            }

            // 🎯 ATRIBUIÇÃO: guarda o código do anúncio no cliente e, se ele
            // pertence a uma campanha cadastrada, amarra a campanha sozinha.
            // Vale a regra do "primeiro contato": não sobrescreve atribuição
            // que já existe (quem trouxe a cliente foi quem trouxe).
            const codigo = adCode(ad);
            if (codigo) {
              const cliente = await db.customer.findUnique({
                where: { id: result.customer.id },
                select: { adRef: true, campaignId: true },
              });
              const campanhas = cliente?.campaignId
                ? []
                : await db.marketingCampaign.findMany({
                    where: { companyId, active: true },
                    select: { id: true, adRefs: true, active: true },
                  });
              const campanha = campanhaDoAnuncio(codigo, campanhas);
              const patch = {
                ...(cliente?.adRef ? {} : { adRef: codigo }),
                ...(campanha ? { campaignId: campanha.id } : {}),
              };
              if (Object.keys(patch).length) {
                await db.customer
                  .update({ where: { id: result.customer.id }, data: patch })
                  .catch(() => {});
              }
            }
          }
        } else {
          // mensagem enviada PELO CELULAR da loja → registra na conversa do
          // cliente (histórico completo), sem reenviar nada. Casamento
          // tolerante a 9º dígito, DDI e formatação (mesma regra do intake).
          let customer = await findCustomerByPhone(companyId, phone);
          if (!customer) {
            // A vendedora puxou assunto pelo APP com um número que ainda não
            // está no CRM (follow-up, indicação, contato de feira). Antes a
            // mensagem era jogada fora e a conversa nunca aparecia no sistema
            // — a loja perdia o atendimento de vista.
            //
            // Cria o contato mínimo. NÃO passa pelo Lead Intake: aqui quem
            // puxou assunto foi a LOJA, então não é lead novo entrando — não
            // cabe distribuir vendedor, abrir oportunidade nem criar tarefa.
            // A conversa nasce na fila (sem dono), igual ao resto do sistema.
            //
            // O nome NÃO pode vir de `pushName`: em mensagem enviada por nós,
            // esse campo é o nome da PRÓPRIA LOJA, não o de quem recebeu.
            customer = await db.customer.create({
              data: {
                companyId,
                name: `Contato ${formatPhone(phone)}`,
                phone,
                origin: "WHATSAPP",
              },
            });
            await db.customerEvent
              .create({
                data: {
                  companyId,
                  customerId: customer.id,
                  type: "LEAD_CRIADO",
                  channel: "WHATSAPP",
                  description:
                    "Contato criado automaticamente: a loja iniciou a conversa pelo aplicativo do WhatsApp.",
                },
              })
              .catch(() => {});
          }
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
          // RESGATE: o eco pode ser uma mensagem que o painel acabou de
          // enviar mas cuja resposta se perdeu (conversão de mídia lenta →
          // timeout → "erro" na tela com o áudio JÁ entregue). Adota a
          // pendente/falhada em vez de criar uma bolha duplicada.
          if (!exists) {
            const pendente = await db.message.findFirst({
              where: {
                conversationId: conv.id,
                direction: "OUT",
                kind: "TEXT",
                externalId: null,
                status: { in: ["ENVIANDO", "FALHOU"] },
                createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
                ...(mediaType !== "TEXT" ? { mediaType } : { mediaType: "TEXT", body: text }),
              },
              orderBy: { createdAt: "desc" },
            });
            if (pendente) {
              await db.message.update({
                where: { id: pendente.id },
                data: {
                  externalId: m.key?.id ?? undefined,
                  status: "ENVIADA",
                  error: null,
                },
              });
              await db.conversation.update({
                where: { id: conv.id },
                data: { lastMessageAt: new Date(), lastOutboundAt: new Date() },
              });
              continue;
            }
          }
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
