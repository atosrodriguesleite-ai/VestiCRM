import webpush from "web-push";
import { after } from "next/server";
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

/**
 * Envia para os dispositivos de UMA pessoa.
 *
 * A agenda do dia é individual — "você tem 7 clientes para chamar" só faz
 * sentido para quem tem as 7. Mandar para a loja inteira faria cada vendedora
 * receber a conta das outras e desligar a notificação na primeira semana.
 */
export async function sendToUser(userId: string, payload: Payload) {
  if (!pushConfigured()) return { sent: 0, skipped: true };
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  return enviarPara(subs, payload);
}

/** Envia uma notificação para todos os dispositivos inscritos da loja. */
export async function sendToCompany(companyId: string, payload: Payload) {
  if (!pushConfigured()) return { sent: 0, skipped: true };
  const subs = await db.pushSubscription.findMany({ where: { companyId } });
  return enviarPara(subs, payload);
}

async function enviarPara(
  subs: { endpoint: string; p256dh: string; auth: string }[],
  payload: Payload
) {
  if (subs.length === 0) return { sent: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        // teto de 5s: um endpoint de push pendurado segurava a função até o
        // limite da Vercel (achado da revisão de performance)
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { timeout: 5000 }
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

/**
 * O AVISO DE VENDA NUNCA SE PERDE NO CONGELAMENTO DA VERCEL.
 *
 * Relato do dono (11/09/2026): "marquei uma venda como pago e não recebi a
 * notificação no celular". O envio era chamado SOLTO, logo antes de a rota
 * responder — e a Vercel congela a função junto com a resposta: o pedido ao
 * serviço de push, que é uma chamada HTTP, ficava pela metade e o celular
 * nunca tocava. Às vezes dava tempo, às vezes não: exatamente o "às vezes
 * chega" que ninguém consegue reproduzir. É o MESMO buraco que a porta única
 * do Financeiro já tinha fechado (RN-033), com a mesma cura: o trabalho vai
 * no `after()` do Next, que a Vercel espera terminar.
 *
 * Vale para TODA porta que fecha uma venda: marcar pago na tela, Pix
 * confirmado pelo gateway e venda da loja online. E "pago" é QUALQUER status
 * pago (RN-001: pago, em produção, separação, enviado, entregue) — quem
 * decide é `enteringPaid` na rota do pedido, com a lista PAID_ORDER_STATUSES.
 */
export function avisarVendaPagaSemQuebrar(
  companyId: string,
  order: { id: string; number: number; total: number; customerName: string }
): void {
  after(() =>
    notifySalePaid(companyId, order).catch((e) =>
      console.error("[push] falhou ao avisar a venda", order.id, e)
    )
  );
}

/** Notificação de venda paga (o "ka-ching" 💰). Prefira `avisarVendaPagaSemQuebrar`. */
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
