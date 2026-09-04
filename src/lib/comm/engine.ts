import { after } from "next/server";
import { db } from "../db";
import { avancarFunil } from "../funil-auto";
import { decryptSecret } from "../crypto";
import { intakeLead } from "../intake";
import { resolveProvider } from "./providers";
import {
  paceProactiveSend,
  WA_JANELA_HORAS,
  evoDeleteForEveryone,
  evoEditMessage,
  evoSendReaction,
  phoneToJid,
} from "./evolution";
import { notifyMentions } from "../notify";
import { reciboMaisForte, reciboAvanca } from "./recibo";
import {
  AVISO_SEM_CONFIRMACAO,
  confirmacaoVenceu,
  MS_CONFIRMANDO_ENTREGA,
  situacaoDoEnvio,
} from "./entrega-incerta";
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

      // NÃO REGRIDE ENVIADA → FALHOU.
      //
      // O eco do webhook pode confirmar a mensagem enquanto o provedor ainda
      // "pensa" (conversão de mídia lenta, rede ruim). Se depois disso o
      // provedor responder com erro, é falso alarme: a mensagem CHEGOU. Marcar
      // FALHOU fazia a vendedora reenviar e a cliente receber duas vezes.
      //
      // O `updateMany` com filtro de status é o que garante isso: só marca
      // falha se a mensagem ainda estiver ENVIANDO.
      if (result.ok) {
        // SÓ avança quem ainda está ENVIANDO/FALHOU: o eco do celular (adoção)
        // ou um recibo aplicado ao vivo podem já ter levado a mensagem a
        // ENVIADA/ENTREGUE/LIDA — sobrescrever com "ENVIADA" faria o ✓✓
        // regredir para ✓ para sempre (achado da revisão de 28/08/2026).
        await db.message.updateMany({
          where: { id: messageId, status: { in: ["ENVIANDO", "FALHOU"] } },
          data: { status: "ENVIADA", externalId: result.externalId, error: null },
        });
        // o recibo pode ter chegado ANTES de o externalId ser gravado
        // (cliente online + provedor lento) — reaplica o que ficou órfão
        if (result.externalId) {
          await aplicarRecibosOrfaos(input.companyId, result.externalId).catch(() => {});
        }
      } else if (situacaoDoEnvio(result) === "confirmando") {
        // TEMPO ESGOTADO NÃO É FALHA (RN-048). A mensagem pode ter sido
        // entregue e só a resposta não ter voltado — marcar vermelho aqui é o
        // que fazia a vendedora reenviar e a cliente receber duas vezes. Fica
        // ENVIANDO, com o motivo guardado, esperando o ECO do WhatsApp (o
        // resgate do webhook adota a bolha e a marca como enviada). Quem
        // fecha o caso, se o eco não vier, é a varredura da janela.
        await db.message.updateMany({
          where: { id: messageId, status: "ENVIANDO" },
          data: { error: result.error },
        });
      } else {
        await db.message.updateMany({
          where: { id: messageId, status: "ENVIANDO" },
          data: { status: "FALHOU", error: result.error },
        });
      }
      const updated = (await db.message.findUnique({ where: { id: messageId } }))!;

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
        // Envio em segundo plano que FALHOU: devolve a cliente para a fila.
        // A conversa já tinha sido marcada como "loja respondeu" lá embaixo
        // (o envio ainda estava em curso); se não deu certo, ela continua
        // esperando e precisa voltar a aparecer para a equipe.
        const fim = await db.message
          .findUnique({ where: { id: messageId }, select: { status: true } })
          .catch(() => null);
        if (fim?.status === "FALHOU") {
          await db.conversation
            .update({
              where: { id: conv.id },
              data: { lastOutboundAt: conv.lastOutboundAt },
            })
            .catch(() => {});
        }
        // qualquer desfecho acorda o sync incremental da inbox
        await db.conversation
          .update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
          .catch(() => {});
      });
    } else {
      // Envio direto (texto): sem esta proteção, qualquer exceção deixava a
      // mensagem presa em ENVIANDO para sempre — a vendedora via o ⏱️ girando
      // e não tinha nem o botão de "Reenviar", porque a bolha nunca chegava a
      // FALHOU. Agora o erro é gravado na própria mensagem.
      try {
        message = await doSend();
      } catch (e) {
        await db.message
          .updateMany({
            where: { id: messageId, status: "ENVIANDO" },
            data: { status: "FALHOU", error: `Erro no envio: ${String(e).slice(0, 200)}` },
          })
          .catch(() => {});
        message = (await db.message.findUnique({ where: { id: messageId } })) ?? message;
      }
    }
  }

  // RESPONDER É ASSUMIR O ATENDIMENTO — e isso é regra de negócio, não de
  // tela. Quem manda mensagem para a cliente passa a ser a responsável pela
  // conversa (se ainda não tinha dona), e conversa encerrada volta a ficar
  // ABERTA: sem isso, a lojista respondia e o atendimento continuava
  // parecendo "fila" ou "histórico", que foi exatamente a queixa dela.
  // Nota interna não conta: anotar não é atender.
  // PRIMEIRA RESPOSTA DA LOJA → o cartão avança para "Primeiro contato".
  // `conv.lastOutboundAt` ainda é o valor de ANTES desta mensagem: nulo
  // significa que a loja nunca tinha falado com ela.
  if (!isNote && !conv.lastOutboundAt && message.status !== "FALHOU") {
    await avancarFunil(input.companyId, conv.customerId, "PRIMEIRO_CONTATO");
  }

  // TENTAR RESPONDER NÃO É TER RESPONDIDO. `lastOutboundAt` é o que decide se
  // a cliente ainda aparece na aba Fila ("esperando a loja"). Marcar mesmo
  // quando o envio falhou tirava a cliente da fila SEM ela ter recebido nada:
  // ficava sem resposta e invisível para todo mundo. Agora só marca quando a
  // mensagem não falhou (no envio em segundo plano, o `after` desfaz se falhar).
  const falhou = message.status === "FALHOU";
  await db.conversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: new Date(),
      unreadCount: 0,
      ...(isNote
        ? {}
        : {
            ...(falhou ? {} : { lastOutboundAt: new Date() }),
            ...(conv.status === "CLOSED" ? { status: "OPEN" as const } : {}),
            ...(!conv.assigneeId && input.authorId ? { assigneeId: input.authorId } : {}),
          }),
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

  // O REENVIO SEGUE A MESMA RÉGUA (RN-048): estourou o tempo, volta para
  // "confirmando" — nunca para o vermelho que convida a um terceiro envio.
  const dados = result.ok
    ? { status: "REENVIADA" as const, externalId: result.externalId, error: null }
    : situacaoDoEnvio(result) === "confirmando"
      ? { status: "ENVIANDO" as const, error: result.error }
      : { status: "FALHOU" as const, error: result.error };
  return db.message.update({ where: { id: message.id }, data: dados });
}

/* ---- a janela de confirmação tem fim (RN-048) -------------------------- */

/** Teto por rodada: loja com muita conversa não segura a tela por isso. */
export const TETO_CONFIRMACOES = 100;

/**
 * Fecha o caso das mensagens que ficaram "confirmando entrega" e nunca
 * receberam o eco do WhatsApp.
 *
 * Dizer "confirmando" para sempre seria pior que o vermelho de antes: a
 * mensagem que REALMENTE não saiu ficaria escondida, a cliente sem resposta e
 * a loja achando que respondeu. Passada a janela, vira falha — com o texto
 * honesto: não deu para confirmar, PODE ter chegado.
 *
 * Como reconhecer uma "confirmando": está ENVIANDO **e tem motivo gravado**.
 * Envio em curso não tem motivo nenhum; só o tempo esgotado escreve ali.
 */
export async function fecharConfirmacoesVencidas(
  companyId: string,
  teto = TETO_CONFIRMACOES
): Promise<number> {
  const limite = new Date(Date.now() - MS_CONFIRMANDO_ENTREGA);
  const vencidas = await db.message.findMany({
    where: {
      conversation: { companyId },
      direction: "OUT",
      status: "ENVIANDO",
      error: { not: null },
      // A JANELA CONTA DE QUANDO A MENSAGEM FICOU INCERTA, não de quando ela
      // nasceu. Pelo `createdAt`, o REENVIO de uma mensagem antiga já nascia
      // vencido: a varredura o marcava como falha em segundos, o vermelho com
      // "Reenviar" voltava e a vendedora clicava de novo — o duplicado que
      // esta regra existe para evitar (achado da revisão, 03/09/2026).
      updatedAt: { lt: limite },
    },
    select: { id: true, conversationId: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: teto,
  });
  if (vencidas.length === 0) return 0;

  const agora = new Date();
  const fechadas = vencidas.filter((m) => confirmacaoVenceu(m.updatedAt, agora));
  if (fechadas.length === 0) return 0;

  await db.message.updateMany({
    // o filtro de status vai DE NOVO aqui: o eco pode ter chegado entre a
    // busca e esta escrita, e marcar falha por cima de uma mensagem já
    // confirmada é o "não regride ENVIADA → FALHOU" de sempre
    where: { id: { in: fechadas.map((m) => m.id) }, status: "ENVIANDO" },
    data: { status: "FALHOU", error: AVISO_SEM_CONFIRMACAO },
  });

  // A CLIENTE VOLTA A ESPERAR. A conversa tinha sido marcada como "a loja
  // respondeu" quando o envio começou; sem desfazer isso, a cliente que NÃO
  // recebeu nada sai da fila e fica invisível para a equipe. O valor certo é
  // recalculado (a última mensagem que de fato saiu), nunca chutado.
  for (const conversationId of new Set(fechadas.map((m) => m.conversationId))) {
    const ultimaQueSaiu = await db.message.findFirst({
      where: {
        conversationId,
        direction: "OUT",
        kind: { not: "NOTE" },
        status: { notIn: ["FALHOU", "ENVIANDO"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    await db.conversation
      .update({
        where: { id: conversationId },
        // o updatedAt acorda o sync da inbox: sem ele a bolha só mudaria
        // quando alguém abrisse a conversa de novo
        data: { lastOutboundAt: ultimaQueSaiu?.createdAt ?? null, updatedAt: agora },
      })
      .catch(() => {});
  }
  return fechadas.length;
}

/** Quanto tempo a varredura de carona espera antes de olhar a mesma loja. */
const MS_ENTRE_VARREDURAS = 30_000;
const ultimaVarredura = new Map<string, number>();

/**
 * A varredura DE CARONA no tráfego (ADR-002: nunca um 3º cron). A inbox
 * pergunta por novidades a cada 3s — é ali que ela pega carona, com trava de
 * tempo para não repetir a consulta a cada batida.
 */
export async function fecharConfirmacoesSemQuebrar(companyId: string): Promise<void> {
  const agora = Date.now();
  if (agora - (ultimaVarredura.get(companyId) ?? 0) < MS_ENTRE_VARREDURAS) return;
  ultimaVarredura.set(companyId, agora);
  try {
    await fecharConfirmacoesVencidas(companyId);
  } catch (e) {
    console.error("[comm] varredura de confirmação falhou", e);
    // erro não vale como "já varri": a próxima batida tenta de novo
    ultimaVarredura.delete(companyId);
  }
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

/**
 * REAGE A UMA MENSAGEM COM EMOJI — o mesmo gesto do aplicativo do WhatsApp.
 *
 * Serve para o "recebi, obrigada" que não merece uma mensagem: a cliente
 * manda o comprovante, a vendedora responde com um 👍 e a conversa não ganha
 * mais uma bolha. É o jeito que todo mundo já usa no celular.
 *
 * Emoji VAZIO remove a reação — é assim que o WhatsApp desfaz, não existe um
 * "apagar reação" separado.
 *
 * Guarda o emoji GRUDADO na mensagem (`reactionStore`, o lado da loja), e não
 * como bolha nova: reação não é conversa, é um sinal em cima do que já foi
 * dito. Reagir também NÃO reabre a conversa nem muda a ordem da lista — só
 * toca o `updatedAt` para o sync de 3s levar a novidade à tela (sem isso a
 * reação ficava gravada no banco e invisível até um F5, o mesmo buraco que
 * já apareceu na edição de mensagem).
 */
export async function reagirNaMensagem(
  companyId: string,
  messageId: string,
  emoji: string
): Promise<Message> {
  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { companyId } },
    include: { conversation: { include: { customer: true } } },
  });
  if (!message) throw new Error("Mensagem não encontrada");
  // nota interna não existe no WhatsApp da cliente: não há no que reagir lá
  if (message.kind === "NOTE")
    throw new Error("Nota interna não vai para o WhatsApp — não dá para reagir.");
  if (message.revoked)
    throw new Error("Esta mensagem foi apagada — não dá para reagir a ela.");

  const s = await db.commSettings.findUnique({ where: { companyId } });
  const noWhatsApp = s?.activeProvider === "EVOLUTION" && !!s.evolutionInstance;
  // SEM ID NO WHATSAPP, A REAÇÃO NÃO TEM ONDE POUSAR. É o caso da mensagem
  // que falhou no envio: ela existe aqui, mas nunca chegou lá. Gravar o emoji
  // assim mesmo deixaria a vendedora convencida de que a cliente viu o 👍 que
  // nunca saiu daqui — melhor dizer a verdade.
  if (noWhatsApp && !message.externalId)
    throw new Error(
      "Esta mensagem não chegou ao WhatsApp da cliente, então não dá para reagir a ela."
    );
  if (noWhatsApp && message.externalId) {
    const res = await evoSendReaction(
      s!.evolutionInstance!,
      {
        id: message.externalId,
        remoteJid: phoneToJid(message.conversation.customer.phone),
        // de que lado está a mensagem em que se reage: a da cliente é
        // `false`, a da loja é `true` — com o lado errado o WhatsApp não
        // encontra a mensagem e a reação não sai
        fromMe: message.direction === "OUT",
      },
      emoji
    );
    if (!res.ok)
      throw new Error("O WhatsApp não aceitou a reação. Tente de novo em instantes.");
  }

  const updated = await db.message.update({
    where: { id: message.id },
    data: { reactionStore: emoji || null },
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
  /**
   * RN-028: a mensagem nasce ANTES do arquivo. `true` = o WhatsApp tem a
   * mídia e nós ainda não — a bolha já existe e o arquivo entra depois
   * (busca imediata ou repesca). Sem isso, a bolha só nascia depois do
   * download e um lote pesado levava as mensagens seguintes embora.
   */
  mediaPending?: boolean;
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
    // A BOLHA DO CATÁLOGO JÁ EXISTE? (RN-043) O pedido do catálogo grava a
    // mensagem na conversa antes de a cliente apertar "enviar" no wa.me;
    // quando a mensagem de verdade chega aqui, ela É aquela bolha — o intake
    // a reaproveita (só a que ainda não tem id do WhatsApp, e só texto) e
    // ela ganha o id e o status logo abaixo, no caminho de sempre. Sem isto
    // a Central mostrava o pedido duas vezes e o celular, uma (01/09/2026).
    ...(!input.mediaType || input.mediaType === "TEXT"
      ? { reaproveitarBolha: "do-catalogo" as const }
      : {}),
    // o id do WhatsApp vai junto para ser carimbado sob a trava (a segunda
    // mensagem igual em paralelo tem que ver a bolha já com id)
    externalId: input.externalId,
  });

  // Completa A MENSAGEM QUE O INTAKE ACABOU DE CRIAR com canal, mídia e o id
  // do WhatsApp.
  //
  // Usa o id devolvido pelo intake, e não "a mensagem IN mais recente da
  // conversa": duas mensagens chegando no mesmo instante (a cliente manda foto
  // e texto em seguida) faziam a busca por "mais recente" devolver a mensagem
  // ERRADA — a foto colava na bolha do texto, o recibo de entrega ia para a
  // bolha errada, e a mensagem que ficava sem id podia entrar duplicada numa
  // reentrega do servidor.
  if (result.conversation) {
    if (result.message) {
      await db.message.update({
        where: { id: result.message.id },
        data: {
          channel: input.channel,
          mediaType: input.mediaType ?? "TEXT",
          mediaUrl: input.mediaUrl,
          fileName: input.fileName,
          externalId: input.externalId,
          mediaPending: input.mediaPending ?? false,
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
      // a mensagem casou com a bolha que o catálogo já tinha criado
      ...(result.mensagemReaproveitada ? { mescladaNaBolhaDoCatalogo: true } : {}),
    },
    durationMs: Date.now() - started,
  });

  return result;
}

/**
 * Recibo de entrega/leitura vindo do webhook do provedor.
 *
 * `anotarOrfao`: só o webhook da Evolution liga — é onde a corrida do eco
 * pelo celular acontece E onde existe quem reaplique (aplicarRecibosOrfaos).
 * Nos outros chamadores (Cloud API, simulador) o recibo sem mensagem é de
 * algo que nunca vai existir no CRM: anotar seria escrita à toa, para sempre.
 */
export async function updateDeliveryStatus(
  companyId: string,
  externalId: string,
  status: Extract<MessageStatus, "ENTREGUE" | "LIDA" | "FALHOU">,
  error?: string,
  opts?: { anotarOrfao?: boolean }
) {
  let message = await db.message.findFirst({
    where: { externalId, conversation: { companyId } },
  });

  // RECIBO DE MENSAGEM QUE AINDA NÃO ESTÁ NO CRM — pode ser das duas coisas:
  //
  //  • mensagem que nunca vai existir aqui (grupo, mensagem de antes da
  //    conexão) — nada a fazer, e não é erro;
  //  • CORRIDA com a gravação (incidente real, 28/08/2026): a mensagem
  //    mandada PELO CELULAR só vira bolha depois que o webhook baixa a mídia
  //    (áudio/foto levam segundos — e um lote de fotos, mais ainda). Com a
  //    cliente ONLINE, o "entregue" chega ANTES de a bolha existir. Jogar o
  //    recibo fora deixava a mensagem no ✓ para sempre — e cliente com
  //    confirmação de leitura desligada nunca manda outro recibo que
  //    conserte depois.
  //
  // Por isso o recibo órfão fica ANOTADO (recibo.orfao, status OK — nada de
  // bolinha vermelha no painel) e é REAPLICADO quando a bolha nasce
  // (aplicarRecibosOrfaos, chamada em todo lugar que grava o externalId).
  // Registrar como ERRO está fora de questão: encheria a Central de falhas
  // falsas e o erro de verdade passaria despercebido.
  if (!message) {
    if (!opts?.anotarOrfao) return null;
    await logEvent({
      companyId,
      channel: "WHATSAPP",
      direction: "IN",
      type: "recibo.orfao",
      status: "OK",
      payload: { externalId, status },
      error,
    }).catch(() => {});
    // a bolha pode ter NASCIDO enquanto o órfão era anotado (a reaplicação
    // dela pode ter varrido ANTES do nosso registro entrar) — confere de
    // novo e, se agora existe, aplica direto. Cada lado escreve e depois
    // olha o outro: um dos dois sempre enxerga o recibo.
    message = await db.message.findFirst({
      where: { externalId, conversation: { companyId } },
    });
    if (!message) return null;
  }

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
  // O STATUS SÓ ANDA PARA FRENTE (reciboAvanca): a reaplicação do órfão ou
  // um recibo atrasado não podem rebaixar LIDA para ENTREGUE, nem carimbar
  // "Falhou" numa mensagem que chegou (achado da revisão de 28/08/2026).
  // Os horários continuam entrando mesmo com o status parado (ex.: LIDA sem
  // deliveredAt ganha o carimbo de entregue).
  const avanca = reciboAvanca(message.status, status);
  const receiptData: Record<string, unknown> = {
    ...(avanca ? { status, ...(error ? { error } : {}) } : {}),
  };
  if (status === "ENTREGUE" && !message.deliveredAt) receiptData.deliveredAt = agora;
  if (status === "LIDA") {
    receiptData.readAt = message.readAt ?? agora;
    if (!message.deliveredAt) receiptData.deliveredAt = agora; // visto implica entregue
  }
  if (Object.keys(receiptData).length === 0) return message; // nada de novo
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

/** janela em que um recibo órfão ainda vale (a corrida se resolve em minutos) */
const RECIBO_ORFAO_JANELA_MS = 30 * 60 * 1000;

/**
 * Reaplica recibos que chegaram ANTES de a mensagem existir no CRM.
 *
 * Chamar em todo lugar que grava um `externalId` novo: o eco do celular
 * (criação e adoção de pendente) e o envio pelo painel. A corrida do
 * incidente de 28/08/2026: cliente online recebe na hora, o DELIVERY_ACK
 * bate na porta enquanto o webhook ainda baixa a mídia da mensagem — sem a
 * reaplicação, o ✓✓ nunca chegava na tela.
 */
export async function aplicarRecibosOrfaos(
  companyId: string,
  externalId: string
): Promise<void> {
  const orfaos = await db.commEvent.findMany({
    where: {
      companyId,
      type: "recibo.orfao",
      createdAt: { gte: new Date(Date.now() - RECIBO_ORFAO_JANELA_MS) },
      payload: { contains: externalId },
    },
    select: { payload: true },
  });
  if (orfaos.length === 0) return;
  const statuses = orfaos
    .map((o) => {
      try {
        const p = JSON.parse(o.payload ?? "{}") as { externalId?: string; status?: string };
        // `contains` pode casar por acaso — confere o id de verdade
        return p.externalId === externalId ? p.status : null;
      } catch {
        return null;
      }
    })
    .filter((s): s is "ENTREGUE" | "LIDA" | "FALHOU" =>
      s === "ENTREGUE" || s === "LIDA" || s === "FALHOU"
    );
  const melhor = reciboMaisForte(statuses);
  if (!melhor) return;
  await updateDeliveryStatus(
    companyId,
    externalId,
    melhor,
    melhor === "FALHOU" ? "O WhatsApp não conseguiu entregar esta mensagem." : undefined
  );
}
