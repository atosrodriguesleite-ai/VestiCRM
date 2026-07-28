import type { Channel, MessageMedia } from "@prisma/client";

/**
 * Contratos da Communication Engine.
 *
 * Nenhuma tela ou rota do CRM fala com um provedor diretamente — tudo passa
 * pela engine (`src/lib/comm/engine.ts`), que resolve o provider ativo da
 * empresa. Trocar Mock ↔ Cloud API é uma linha de configuração; nenhuma
 * tela muda.
 */

export type OutboundPayload = {
  to: string; // telefone/identificador no canal (E.164 para WhatsApp)
  text?: string;
  mediaType?: MessageMedia;
  mediaUrl?: string;
  fileName?: string;
  templateName?: string;
  /**
   * Mensagem citada, quando é uma RESPOSTA. Precisa ir completa (id + de quem
   * é + conteúdo): citação só com o id vira citação sem autor e o WhatsApp
   * pode não conseguir montar a mensagem.
   */
  replyTo?: {
    externalId: string;
    /** a citada foi enviada pela loja (OUT) ou pela cliente (IN)? */
    fromMe: boolean;
    texto?: string;
  };
};

export type SendResult =
  | { ok: true; externalId: string }
  | { ok: false; error: string };

export interface CommProvider {
  readonly name: string;
  readonly channel: Channel;
  /** true quando as credenciais necessárias estão presentes */
  readonly configured: boolean;
  /** envia mensagem (texto, mídia ou template) */
  send(payload: OutboundPayload): Promise<SendResult>;
}

export type ProviderCredentials = {
  metaAppId?: string | null;
  metaAppSecret?: string | null;
  phoneNumberId?: string | null;
  accessToken?: string | null;
  instagramAccountId?: string | null;
  facebookPageId?: string | null;
  telegramBotToken?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  // WhatsApp sem API oficial (Evolution)
  evolutionInstance?: string | null;
};
