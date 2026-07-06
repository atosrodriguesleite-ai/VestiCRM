/**
 * Camada de integração com WhatsApp.
 *
 * O CRM fala apenas com a interface `WhatsAppProvider`. Hoje usamos o
 * `SimulatedProvider` (mensagens ficam registradas no CRM, sem envio real).
 * Para conectar a API oficial (WhatsApp Cloud API), basta implementar
 * `CloudApiProvider` com as mesmas assinaturas e trocar o export — nenhuma
 * tela ou rota precisa mudar.
 *
 * Webhook de entrada previsto em: POST /api/whatsapp/webhook
 */

export type OutgoingMessage = {
  phone: string; // E.164, ex.: 5511998761001
  body: string;
};

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  readonly isSimulated: boolean;
  send(msg: OutgoingMessage): Promise<SendResult>;
}

class SimulatedProvider implements WhatsAppProvider {
  readonly name = "Simulado (sem integração)";
  readonly isSimulated = true;

  async send(msg: OutgoingMessage): Promise<SendResult> {
    // Nenhum envio real — a mensagem é registrada no histórico do CRM.
    return { ok: true, providerMessageId: `sim_${Date.now()}_${msg.phone}` };
  }
}

/*
class CloudApiProvider implements WhatsAppProvider {
  readonly name = "WhatsApp Cloud API";
  readonly isSimulated = false;

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: msg.phone,
          type: "text",
          text: { body: msg.body },
        }),
      }
    );
    if (!res.ok) return { ok: false, error: await res.text() };
    const data = await res.json();
    return { ok: true, providerMessageId: data.messages?.[0]?.id };
  }
}
*/

export const whatsapp: WhatsAppProvider = new SimulatedProvider();
