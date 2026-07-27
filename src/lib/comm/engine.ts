import { after } from "next/server";
import { db } from "../db";
import { decryptSecret } from "../crypto";
import { intakeLead } from "../intake";
import { resolveProvider } from "./providers";
import {
  paceProactiveSend,
  WA_JANELA_HORAS,
  evoDeleteForEveryone,
  evoEditMessage,
  phoneToJid,
} from "./evolution";
import { notifyMentions } from "../notify";
import type { ProviderCredentials } from "./types";
import type {
  Channel,
  Message,
  MessageKind,
  MessageMedia,
  MessageStatus,
} from "@prisma/client";

/**
 * Communication Engine — ponto único de envio/recebimento de mensagens.
 *
 * Fluxo de envio:  tela → API → engine.sendMessage → provider → status
 * Fluxo de entrada: webhook → engine.receiveMessage → Lead Intake Engine
 * Recibos:          webhook → engine.updateDeliveryStatus
 *
 * Tudo é registrado em CommEvent (payload, resposta, latência, tentativas)
 * para o painel Central de Comunicação.
 */

async function loadCredentials(companyId: string): Promise<{
  activeProvider: string;
  creds: ProviderCredentials;
}> {
  const s = await db.commSettings.findUnique({ where: { companyId } });
  if (!s) return { activeProvider: "MOCK", creds: {} };
  const dec = (v: string | null) => (v ? decryptSecret(v) : null);
  return {
    activeProvider: s.activeProvider,
    creds: {
      metaAppId: s.metaAppId,
      metaAppSecret: dec(s.metaAppSecret),
      phoneNumberId: s.phoneNumberId,
      accessToken: dec(s.accessToken),
      instagramAccountId: s.instagramAccountId,
      facebookPageId: s.facebookPageId,
      telegramBotToken: dec(s.telegramBotToken),
      smtpHost: s.smtpHost,
      smtpPort: s.smtpPort,
      smtpUser: s.smtpUser,
      smtpPassword: dec(s.smtpPassword),
      evolutionInstance: s.evolutionInstance,
    },
  };
}

async function logEvent(input: {
  companyId?: string;
  channel: Channel;
  direction: "IN" | "OUT";
  type: string;
  status: "OK" | "ERRO";
  payload?: unknown;
  response?: unknown;
  error?: string;
  durationMs?: number;
  attempts?: number;
}) {
  await db.commEvent.create({
    data: {
      companyId: input.companyId,
      channel: input.channel,
      direction: input.direction,
      type: input.type,
      status: input.status,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      response: input.response ? JSON.stringify(input.response) : null,
      error: input.error,
      durationMs: input.durationMs ?? 0,
      attempts: input.attempts ?? 1,
    },
  });
}

export type SendMessageInput = {
  conversationId: string;
  companyId: string;
  body: string;
  kind?: MessageKind;
  mediaType?: MessageMedia;
  mediaUrl?: string;
  fileName?: string;
  replyToId?: string;
  authorId?: string;
  authorName?: string;
  /**
   * Envio em SEGUNDO PLANO: a chamada devolve a mensagem ENVIANDO na hora e o
   * provedor trabalha depois da resposta (after). Usado para mídia (áudio/
   * foto/vídeo), que demora — segurar a resposta até o fim era o que fazia a
   * tela mostrar erro com o áudio já entregue no cliente.
   */
  background?: boolean;
};

/** Envia mensagem por qualquer canal. Notas internas nunca saem do CRM. */
export async function sendMessage(input: SendMessageInput): Promise<Message> {
  const conv = await db.conversation.findFirst({
    where: { id: input.conversationId, companyId: input.companyId },
    include: { customer: true },
  });
  if (!conv) throw new Error("Conversa não encontrada");

  const kind = input.kind ?? "TEXT";
  const isNote = kind === "NOTE";

  // registra a mensagem primeiro (fila: status ENVIANDO)
  let message = await db.message.create({
    data: {
      conversationId: conv.id,
      channel: conv.channel,
      direction: "OUT",
      kind,
      mediaType: input.mediaType ?? "TEXT",
      body: input.body,
      mediaUrl: input.mediaUrl,
      fileName: input.fileName,
      replyToId: input.replyToId,
      status: isNote ? "ENVIADA" : "ENVIANDO",
      authorId: input.authorId,
    },
  });

  // nota interna: avisa (sino) quem foi mencionado com @ na nota
  if (isNote && input.authorName) {
    await notifyMentions({
      companyId: input.companyId,
      convId: conv.id,
      authorId: input.authorId,
      authorName: input.authorName,
      customerName: conv.customer.name,
      note: input.body,
    });
  }

  if (!isNote) {
    const messageId = message.id;
    const doSend = async (): Promise<Message> => {
      const started = Date.now();
      const { activeProvider, creds } = await loadCredentials(input.companyId);
      const provider = resolveProvider(conv.channel, activeProvider, creds);

      // conexão sem API oficial: proteção anti-bloqueio SEM travar o vendedor.
      // Resposta a quem te chamou (janela de 24h) sai na hora; envio proativo/
      // frio recebe um ritmo humano (intervalo variável) antes de sair.
      if (conv.channel === "WHATSAPP" && activeProvider === "EVOLUTION") {
        const janelaMs = WA_JANELA_HORAS * 60 * 60 * 1000;
        const dentroDaJanela =
          conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < janelaMs;
        if (!dentroDaJanela) await paceProactiveSend(input.companyId);
      }

      // resposta a mensagem específica: leva o id externo da citada para o
      // WhatsApp mostrar a "caixinha" da mensagem original em cima
      let replyTo: { externalId: string; fromMe: boolean; texto?: string } | undefined;
      if (input.replyToId) {
        const citada = await db.message.findFirst({
          where: { id: input.replyToId, conversationId: conv.id },
          select: { externalId: true, direction: true, body: true },
        });
        if (citada?.externalId) {
          replyTo = {
            externalId: citada.externalId,
            fromMe: citada.direction === "OUT",
            texto: citada.body || undefined,
          };
        }
      }

      const result = await provider.send({
        to: conv.customer.phone,
        text: input.mediaType && input.mediaType !== "TEXT" ? undefined : input.body,
        mediaType: input.mediaType,
        mediaUrl: input.mediaUrl,
        fileName: input.fileName,
        replyTo,
      });
      const durationMs = Date.now() - started;

      // se o eco do webhook já confirmou a mensagem enquanto o provedor
      // "pensava" (resgate), não regride ENVIADA → FALHOU
      const updated = await db.message.update({
        where: { id: messageId },
        data: result.ok
          ? { status: "ENVIADA", externalId: result.externalId, error: null }
          : { status: "FALHOU", error: result.error },
      });

      await logEvent({
        companyId: input.companyId,
        channel: conv.channel,
        direction: "OUT",
        type: "message.sent",
        status: result.ok ? "OK" : "ERRO",
        payload: {
          provider: provider.name,
          to: conv.customer.phone,
          mediaType: input.mediaType ?? "TEXT",
          preview: input.body.slice(0, 80),
        },
        response: result.ok ? { externalId: result.externalId } : undefined,
        error: result.ok ? undefined : result.error,
        durationMs,
      });
      return updated;
    };

    if (input.background) {
      // devolve ENVIANDO já; o provedor roda depois da resposta e o sync da
      // inbox (3s) troca o ⏱️ pelo ✓ (ou mostra o erro real com "Reenviar")
      after(async () => {
        try {
          const atual = await db.message.findUnique({ where: { id: messageId } });
          // eco do webhook pode ter confirmado antes do provedor responder
          if (atual && atual.status === "ENVIANDO") await doSend();
        } catch (e) {
          await db.message
            .update({
              where: { id: messageId },
              data: { status: "FALHOU", error: `Erro no envio: ${String(e).slice(0, 200)}` },
            })
            .catch(() => {});
        }
        // qualquer desfecho acorda o sync incremental da inbox
        await db.conversation
          .update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
          .catch(() => {});
      });
    } else {
      message = await doSend();
    }
  }

  await db.conversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: new Date(),
      unreadCount: 0,
      ...(isNote ? {} : { lastOutboundAt: new Date() }),
    },
  });
  if (!isNote) {
    await db.customer.update({
      where: { id: conv.customerId },
      data: { lastContactAt: new Date() },
    });
  }

  return message;
}

/** Reenvia uma mensagem que falhou (nova tentativa no provider). */
export async function resendMessage(
  companyId: string,
  messageId: string
): Promise<Message> {
  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { companyId } },
    include: { conversation: { include: { customer: true } } },
  });
  if (!message) throw new Error("Mensagem não encontrada");

  const started = Date.now();
  const { activeProvider, creds } = await loadCredentials(companyId);
  const provider = resolveProvider(message.channel, activeProvider, creds);
  const result = await provider.send({
    to: message.conversation.customer.phone,
    text: message.mediaType === "TEXT" ? message.body : undefined,
    mediaType: message.mediaType,
    mediaUrl: message.mediaUrl ?? undefined,
  });

  await logEvent({
    companyId,
    channel: message.channel,
    direction: "OUT",
    type: "message.resent",
    status: result.ok ? "OK" : "ERRO",
    payload: { messageId, preview: message.body.slice(0, 80) },
    error: result.ok ? undefined : result.error,
    durationMs: Date.now() - started,
    attempts: 2,
  });

  return db.message.update({
    where: { id: message.id },
    data: result.ok
      ? { status: "REENVIADA", externalId: result.externalId, error: null }
      : { status: "FALHOU", error: result.error },
  });
}

/**
 * Apaga a mensagem "para todos" (some do WhatsApp do cliente). Mantém a
 * mensagem no CRM marcada como apagada — o histórico interno não se perde.
 */
export async function revokeMessage(
  companyId: string,
  messageId: string
): Promise<Message> {
  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { companyId } },
    include: { conversation: { include: { customer: true } } },
  });
  if (!message) throw new Error("Mensagem não encontrada");
  if (message.direction !== "OUT" || message.kind === "NOTE")
    throw new Error("Só dá para apagar para o cliente as mensagens que a loja enviou.");

  const s = await db.commSettings.findUnique({ where: { companyId } });
  if (s?.activeProvider === "EVOLUTION" && s.evolutionInstance && message.externalId) {
    const res = await evoDeleteForEveryone(s.evolutionInstance, {
      id: message.externalId,
      remoteJid: phoneToJid(message.conversation.customer.phone),
      fromMe: true,
    });
    if (!res.ok)
      throw new Error(
        "O WhatsApp não deixou apagar — o prazo para apagar para todos (cerca de 2 dias) pode ter passado."
      );
  }

  const updated = await db.message.update({
    where: { id: message.id },
    data: { revoked: true, revokedBy: "STORE" },
  });
  await db.conversation.update({
    where: { id: message.conversationId },
    data: { updatedAt: new Date() },
  });
  return updated;
}

/**
 * Edita o texto de uma mensagem enviada. O WhatsApp só permite editar até
 * ~15 minutos depois do envio (regra da Meta).
 */
export async function editMessageText(
  companyId: string,
  messageId: string,
  text: string
): Promise<Message> {
  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { companyId } },
    include: { conversation: { include: { customer: true } } },
  });
  if (!message) throw new Error("Mensagem não encontrada");
  if (message.direction !== "OUT" || message.kind === "NOTE" || message.mediaType !== "TEXT")
    throw new Error("Só dá para editar mensagens de texto enviadas pela loja.");

  const s = await db.commSettings.findUnique({ where: { companyId } });
  if (s?.activeProvider === "EVOLUTION" && s.evolutionInstance && message.externalId) {
    const number = message.conversation.customer.phone.replace(/\D/g, "");
    const res = await evoEditMessage(
      s.evolutionInstance,
      number,
      {
        id: message.externalId,
        remoteJid: phoneToJid(message.conversation.customer.phone),
        fromMe: true,
      },
      text
    );
    if (!res.ok)
      throw new Error(
        "O WhatsApp não deixou editar — o prazo de 15 minutos pode ter passado."
      );
  }

  const updated = await db.message.update({
    where: { id: message.id },
    data: { body: text, editedAt: new Date() },
  });
  await db.conversation.update({
    where: { id: message.conversationId },
    data: { updatedAt: new Date() },
  });
  return updated;
}

export type ReceiveMessageInput = {
  channel: Channel;
  phone: string;
  name?: string;
  text: string;
  mediaType?: MessageMedia;
  mediaUrl?: string;
  fileName?: string;
  externalId?: string;
};

/** Entrada de mensagem (webhook) — delega ao Lead Intake Engine. */
export async function receiveMessage(
  companyId: string,
  input: ReceiveMessageInput
) {
  const started = Date.now();
  const result = await intakeLead(companyId, {
    phone: input.phone,
    name: input.name,
    origin: input.channel, // Channel ⊂ Origin (todo canal é uma origem)
    message: input.text,
  });

  // enriquece a mensagem criada pelo intake com canal/mídia/externalId
  if (result.conversation) {
    const lastMsg = await db.message.findFirst({
      where: { conversationId: result.conversation.id, direction: "IN" },
      orderBy: { createdAt: "desc" },
    });
    if (lastMsg) {
      await db.message.update({
        where: { id: lastMsg.id },
        data: {
          channel: input.channel,
          mediaType: input.mediaType ?? "TEXT",
          mediaUrl: input.mediaUrl,
          fileName: input.fileName,
          externalId: input.externalId,
          status: "RECEBIDA",
        },
      });
    }
    // Central de Atendimento: chamado novo entra no setor padrão do número
    // (só quando ainda não tem setor — não muda o setor de um chamado em curso).
    let setorPatch = {};
    if (!result.conversation.setorId) {
      const comm = await db.commSettings.findUnique({
        where: { companyId },
        select: { defaultSetorId: true },
      });
      if (comm?.defaultSetorId) setorPatch = { setorId: comm.defaultSetorId };
    }
    await db.conversation.update({
      where: { id: result.conversation.id },
      data: { channel: input.channel, lastInboundAt: new Date(), ...setorPatch },
    });
  }

  await logEvent({
    companyId,
    channel: input.channel,
    direction: "IN",
    type: "message.received",
    status: "OK",
    payload: {
      phone: input.phone,
      mediaType: input.mediaType ?? "TEXT",
      preview: input.text.slice(0, 80),
      isNewLead: result.isNewLead,
    },
    durationMs: Date.now() - started,
  });

  return result;
}

/** Recibo de entrega/leitura vindo do webhook do provedor. */
export async function updateDeliveryStatus(
  companyId: string,
  externalId: string,
  status: Extract<MessageStatus, "ENTREGUE" | "LIDA" | "FALHOU">,
  error?: string
) {
  const message = await db.message.findFirst({
    where: { externalId, conversation: { companyId } },
  });

  // RECIBO DE MENSAGEM QUE NÃO É NOSSA — não é erro, é rotina.
  //
  // O WhatsApp manda recibo de entrega/leitura de TUDO que passa pelo
  // número: mensagens digitadas no celular, conversas de grupo, mensagens
  // antigas de antes da conexão. Nada disso está no CRM, então não há o que
  // atualizar — e não há nada errado nisso.
  //
  // Registrar cada um como ERRO enchia a Central de Comunicação de bolinhas
  // vermelhas e inflava o contador de "falhas nas últimas 24h" que a lojista
  // vê. Com o painel gritando falha o tempo todo, o erro DE VERDADE passa
  // despercebido. Então esse recibo é simplesmente ignorado, em silêncio.
  if (!message) return null;

  await logEvent({
    companyId,
    channel: message.channel,
    direction: "IN",
    type: "status.update",
    status: "OK",
    payload: { externalId, status },
    error,
  });
  // grava o HORÁRIO do recibo: entregue e visto (não retrocede um status)
  const agora = new Date();
  const receiptData: Record<string, unknown> = { status, ...(error ? { error } : {}) };
  if (status === "ENTREGUE" && !message.deliveredAt) receiptData.deliveredAt = agora;
  if (status === "LIDA") {
    receiptData.readAt = message.readAt ?? agora;
    if (!message.deliveredAt) receiptData.deliveredAt = agora; // visto implica entregue
  }
  const updated = await db.message.update({
    where: { id: message.id },
    data: receiptData,
  });
  // marca a conversa como alterada → o sync incremental da inbox atualiza os ✓✓
  await db.conversation.update({
    where: { id: message.conversationId },
    data: { updatedAt: new Date() },
  });
  return updated;
}
