import type { Channel } from "@prisma/client";
import type { CommProvider, OutboundPayload, SendResult, ProviderCredentials } from "./types";

/**
 * Providers da Communication Engine.
 *
 * MockProvider   → funcional hoje (registra no CRM, sem tráfego externo).
 * CloudApiProvider / InstagramProvider / FacebookProvider / TelegramProvider /
 * EmailProvider / SmsProvider → estrutura pronta; ativam quando as
 * credenciais forem preenchidas em Configurações → Comunicação.
 */

export class MockProvider implements CommProvider {
  readonly name = "Mock (simulado)";
  readonly channel: Channel;
  readonly configured = true;

  constructor(channel: Channel = "WHATSAPP") {
    this.channel = channel;
  }

  async send(payload: OutboundPayload): Promise<SendResult> {
    // Simula o aceite do provedor. Nenhuma chamada externa.
    if (payload.text?.includes("[simular-falha]")) {
      return { ok: false, error: "Falha simulada pelo Mock Provider" };
    }
    return {
      ok: true,
      externalId: `mock.${this.channel.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

export class CloudApiProvider implements CommProvider {
  readonly name = "WhatsApp Cloud API";
  readonly channel: Channel = "WHATSAPP";
  readonly configured: boolean;

  constructor(private creds: ProviderCredentials) {
    this.configured = Boolean(creds.phoneNumberId && creds.accessToken);
  }

  async send(payload: OutboundPayload): Promise<SendResult> {
    if (!this.configured) {
      return {
        ok: false,
        error:
          "Cloud API sem credenciais. Preencha Phone Number ID e Access Token em Configurações → Comunicação.",
      };
    }
    // Estrutura pronta — descomentavel quando as credenciais oficiais chegarem:
    //
    // const body = payload.mediaUrl
    //   ? { messaging_product: "whatsapp", to: payload.to,
    //       type: payload.mediaType?.toLowerCase(),
    //       [payload.mediaType!.toLowerCase()]: { link: payload.mediaUrl } }
    //   : { messaging_product: "whatsapp", to: payload.to,
    //       type: "text", text: { body: payload.text ?? "" } };
    // const res = await fetch(
    //   `https://graph.facebook.com/v21.0/${this.creds.phoneNumberId}/messages`,
    //   { method: "POST",
    //     headers: { Authorization: `Bearer ${this.creds.accessToken}`,
    //                "Content-Type": "application/json" },
    //     body: JSON.stringify(body) });
    // if (!res.ok) return { ok: false, error: await res.text() };
    // const data = await res.json();
    // return { ok: true, externalId: data.messages?.[0]?.id };
    return { ok: false, error: "Cloud API ainda não ativada (aguardando credenciais)." };
  }
}

class StructureOnlyProvider implements CommProvider {
  readonly configured: boolean;
  constructor(
    readonly name: string,
    readonly channel: Channel,
    configured = false
  ) {
    this.configured = configured;
  }
  async send(): Promise<SendResult> {
    return {
      ok: false,
      error: `${this.name} ainda não configurado. Estrutura pronta em src/lib/comm/providers.ts.`,
    };
  }
}

export class InstagramProvider extends StructureOnlyProvider {
  constructor(creds: ProviderCredentials) {
    super("Instagram Direct", "INSTAGRAM", Boolean(creds.instagramAccountId && creds.accessToken));
  }
}
export class FacebookProvider extends StructureOnlyProvider {
  constructor(creds: ProviderCredentials) {
    super("Facebook Messenger", "FACEBOOK", Boolean(creds.facebookPageId && creds.accessToken));
  }
}
export class TelegramProvider extends StructureOnlyProvider {
  constructor(creds: ProviderCredentials) {
    super("Telegram", "TELEGRAM", Boolean(creds.telegramBotToken));
  }
}
export class EmailProvider extends StructureOnlyProvider {
  constructor(creds: ProviderCredentials) {
    super("E-mail (SMTP)", "EMAIL", Boolean(creds.smtpHost && creds.smtpUser));
  }
}
export class SmsProvider extends StructureOnlyProvider {
  constructor() {
    super("SMS", "SMS", false);
  }
}

/** Resolve o provider do canal conforme configuração da empresa. */
export function resolveProvider(
  channel: Channel,
  activeProvider: string,
  creds: ProviderCredentials
): CommProvider {
  if (channel === "WHATSAPP") {
    return activeProvider === "CLOUD_API"
      ? new CloudApiProvider(creds)
      : new MockProvider("WHATSAPP");
  }
  switch (channel) {
    case "INSTAGRAM":
      return new InstagramProvider(creds);
    case "FACEBOOK":
      return new FacebookProvider(creds);
    case "TELEGRAM":
      return new TelegramProvider(creds);
    case "EMAIL":
      return new EmailProvider(creds);
    default:
      return new SmsProvider();
  }
}
