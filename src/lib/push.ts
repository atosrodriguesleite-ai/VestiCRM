import webpush from "web-push";
import { db } from "./db";

/**
 * Web Push — notifica o celular do lojista quando um pedido vira PAGO.
 * Requer as variáveis de ambiente VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
 * (e opcionalmente VAPID_SUBJECT). Sem elas, tudo vira no-op silencioso.
 */

const PUBLIC = process.env.VAPID_PUBLIC_KEY?.trim();
const PRIVATE = process.env.VAPID_PRIVATE_KEY?.trim();
const SUBJECT = process.env.VAPID_SUBJECT?.trim() || "mailto:contato@atacadopro.com";

let ready = false;
export function pushConfigured(): boolean {
  if (ready) return true;
  if (!PUBLIC || !PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  ready = true;
  return true;
}

export function vapidPublicKey(): string | null {
  return PUBLIC ?? null;
}

export async function saveSubscription(input: {
  companyId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}) {
  await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      companyId: input.companyId,
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
    update: {
      companyId: input.companyId,
      userId: input.userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function removeSubscription(endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint } });
}

type Payload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/** Envia uma notificação para todos os dispositivos inscritos da loja. */
export async function sendToCompany(companyId: string, payload: Payload) {
  if (!pushConfigured()) return { sent: 0, skipped: true };
  const subs = await db.pushSubscription.findMany({ where: { companyId } });
  if (subs.length === 0) return { sent: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body
        );
        sent++;
      } catch (err: unknown) {
        // 404/410 = inscrição morta (app desinstalado/permissão revogada)
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await db.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
        }
      }
    })
  );
  return { sent };
}

/** Notificação de venda paga (o "ka-ching" 💰). */
export async function notifySalePaid(
  companyId: string,
  order: { id: string; number: number; total: number; customerName: string }
) {
  const brl = `R$ ${order.total.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
  return sendToCompany(companyId, {
    title: "💰 Venda recebida!",
    body: `Pedido #${String(order.number).padStart(4, "0")} · ${order.customerName} · ${brl}`,
    url: `/pedidos/${order.id}`,
    tag: `venda-${order.id}`,
  });
}
