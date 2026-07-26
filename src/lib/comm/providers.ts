import type { Channel } from "@prisma/client";
import type { CommProvider, OutboundPayload, SendResult, ProviderCredentials } from "./types";
import { evolutionEnv, evoSendText, evoSendMedia, evoSendAudio } from "./evolution";

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
    // Envio oficial pela Meta Cloud API (texto, mídia por link ou template)
    const to = payload.to.replace(/\D/g, "");
    let body: Record<string, unknown>;
    if (payload.templateName) {
      body = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: { name: payload.templateName, language: { code: "pt_BR" } },
      };
    } else if (payload.mediaUrl && payload.mediaType && payload.mediaType !== "TEXT") {
      const kind = payload.mediaType.toLowerCase(); // image|audio|video|document
      body = {
        messaging_product: "whatsapp",
        to,
        type: kind,
        [kind]: {
          link: payload.mediaUrl,
          ...(payload.text ? { caption: payload.text } : {}),
          ...(payload.fileName && kind === "document" ? { filename: payload.fileName } : {}),
        },
      };
    } else {
      body = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: payload.text ?? "", preview_url: true },
      };
    }

    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${this.creds.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.creds.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          (data as { error?: { message?: string } } | null)?.error?.message ??
          `HTTP ${res.status}`;
        return { ok: false, error: `Meta recusou o envio: ${detail}` };
      }
      const externalId = (data as { messages?: { id: string }[] })?.messages?.[0]?.id;
      if (!externalId) return { ok: false, error: "Meta não devolveu o id da mensagem." };
      return { ok: true, externalId };
    } catch (e) {
      return { ok: false, error: `Falha de rede ao falar com a Meta: ${String(e)}` };
    }
  }
}

/**
 * WhatsApp SEM API oficial — envia pelo número conectado via servidor
 * Evolution (instância própria da loja). Mídia ainda não é suportada neste
 * modo: mensagens de mídia caem com erro claro em vez de sumirem.
 */
export class EvolutionProvider implements CommProvider {
  readonly name = "WhatsApp (sem API oficial)";
  readonly channel: Channel = "WHATSAPP";
  readonly configured: boolean;

  constructor(private instance: string | null | undefined) {
    this.configured = Boolean(instance && evolutionEnv().configured);
  }

  async send(payload: OutboundPayload): Promise<SendResult> {
    if (!this.configured) {
      return {
        ok: false,
        error:
          "WhatsApp não conectado. Vá em Comunicação e conecte o número da loja pelo QR Code.",
      };
    }
    const number = payload.to.replace(/\D/g, "");
    const mt = payload.mediaType;
    let res;
    if (mt && mt !== "TEXT" && mt !== "TEMPLATE" && payload.mediaUrl) {
      if (mt === "AUDIO") {
        res = await evoSendAudio(this.instance!, number, payload.mediaUrl);
      } else {
        const kind = mt === "IMAGE" ? "image" : mt === "VIDEO" ? "video" : "document";
        res = await evoSendMedia(
          this.instance!,
          number,
          kind,
          payload.mediaUrl,
          payload.fileName,
          payload.text
        );
      }
    } else {
      res = await evoSendText(
        this.instance!,
        number,
        payload.text ?? "",
        payload.replyToExternalId
      );
    }
    if (!res.ok) {
      // devolve o motivo que o servidor deu (encurtado) — sem ele, todo erro
      // vira um "HTTP 4xx" genérico impossível de diagnosticar
      const motivo = res.data
        ? ` Detalhe: ${JSON.stringify(res.data).slice(0, 160)}`
        : "";
      return {
        ok: false,
        error:
          res.status === 0
            ? "Servidor de conexão do WhatsApp fora do ar — tente novamente em instantes."
            : `O WhatsApp recusou o envio (HTTP ${res.status}).${motivo}`,
      };
    }
    const externalId =
      res.data?.key?.id ?? `evo.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    return { ok: true, externalId };
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
    if (activeProvider === "CLOUD_API") return new CloudApiProvider(creds);
    if (activeProvider === "EVOLUTION")
      return new EvolutionProvider(creds.evolutionInstance);
    return new MockProvider("WHATSAPP");
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
