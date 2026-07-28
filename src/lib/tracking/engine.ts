import { db } from "../db";
import { normalizePhone } from "../intake";
import { forwardToDestinations } from "./destinations";

/**
 * Tracking Engine — camada ÚNICA de eventos da Inteligência Comercial.
 *
 * Nenhuma tela grava eventos diretamente: o catálogo envia lotes para
 * /api/track, que chama esta engine. Relatórios consomem os dados via
 * `insights.ts` (a API de leitura da engine) ou GET /api/intelligence —
 * nunca consultando o banco por conta própria.
 *
 * LGPD: IP mascarado, visitante anônimo até consentir/identificar,
 * isolamento total por empresa.
 */

// ---- Classificação de canal a partir do ref/UTM/referer -------------------

const REF_CHANNELS: [RegExp, string][] = [
  [/insta|ig\b/i, "instagram"],
  [/face|fb\b/i, "facebook"],
  [/google-meu|gmb|meu-negocio/i, "google-meu-negocio"],
  [/google|adwords/i, "google"],
  [/whats|zap/i, "whatsapp"],
  [/qr/i, "qr"],
  [/indica/i, "indicacao"],
  [/loja|vitrine|balcao|provador|caixa/i, "loja-fisica"],
  [/marketplace|shopee|meli/i, "marketplace"],
  [/site|blog/i, "site"],
  [/tiktok|tt\b/i, "tiktok"],
];

export function classifyChannel(input: {
  ref?: string | null;
  utmSource?: string | null;
  referer?: string | null;
  campaignChannel?: string | null;
  isSeller?: boolean;
}): string {
  if (input.campaignChannel) return input.campaignChannel;
  const probe = `${input.ref ?? ""} ${input.utmSource ?? ""}`.trim();
  if (probe) {
    for (const [rx, channel] of REF_CHANNELS) {
      if (rx.test(probe)) return channel;
    }
    if (input.isSeller) return "vendedor";
    if (input.ref) return "campanha";
  }
  const ref = input.referer ?? "";
  if (/instagram\./i.test(ref)) return "instagram";
  if (/facebook\.|fb\./i.test(ref)) return "facebook";
  if (/google\./i.test(ref)) return "google";
  if (/whatsapp|wa\.me/i.test(ref)) return "whatsapp";
  if (ref) return "site";
  return "direto";
}

/** LGPD: zera o último octeto (IPv4) / trunca IPv6. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  if (first.includes(".")) {
    const parts = first.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (first.includes(":")) {
    return first.split(":").slice(0, 3).join(":") + "::";
  }
  return null;
}

/** Navegador / SO / dispositivo a partir do user-agent (leve, sem lib). */
export function parseUserAgent(ua: string | null | undefined): {
  device: string;
  os: string;
  browser: string;
} {
  const s = ua ?? "";
  const device = /mobile|iphone|android(?!.*tablet)/i.test(s)
    ? "mobile"
    : /ipad|tablet/i.test(s)
      ? "tablet"
      : "desktop";
  const os = /iphone|ipad|ios/i.test(s)
    ? "iOS"
    : /android/i.test(s)
      ? "Android"
      : /windows/i.test(s)
        ? "Windows"
        : /mac os/i.test(s)
          ? "macOS"
          : /linux/i.test(s)
            ? "Linux"
            : "Outro";
  const browser = /edg\//i.test(s)
    ? "Edge"
    : /opr\//i.test(s)
      ? "Opera"
      : /samsungbrowser/i.test(s)
        ? "Samsung"
        : /firefox/i.test(s)
          ? "Firefox"
          : /chrome|crios/i.test(s)
            ? "Chrome"
            : /safari/i.test(s)
              ? "Safari"
              : "Outro";
  return { device, os, browser };
}

/** Resolve um ref (?ref=julia / campanha) em vendedor e/ou campanha. */
export async function resolveRef(companyId: string, refRaw: string) {
  const ref = refRaw.trim().toLowerCase();
  let sellerId: string | null = null;
  let campaignId: string | null = null;
  let campaignChannel: string | null = null;
  const campaign = await db.trackCampaign.findFirst({
    where: { companyId, slug: ref, active: true },
  });
  if (campaign) {
    campaignId = campaign.id;
    campaignChannel = campaign.channel;
    sellerId = campaign.ownerId;
  } else {
    const users = await db.user.findMany({
      where: { companyId, active: true },
    });
    // o link identifica a vendedora pelo PRIMEIRO NOME. Se duas pessoas da
    // equipe têm o mesmo primeiro nome (duas Julianas), qualquer escolha aqui
    // seria chute — e chute em comissão é dinheiro no bolso errado. Nesse
    // caso ninguém é atribuído e o pedido segue a regra da carteira.
    const candidatos = users.filter(
      (u) =>
        u.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/\s+/)[0] === ref
    );
    if (candidatos.length === 1) sellerId = candidatos[0].id;
  }
  return { sellerId, campaignId, campaignChannel };
}

// ---- Sessões ---------------------------------------------------------------

export type StartSessionInput = {
  companyId: string;
  visitorId?: string | null;
  ref?: string | null;
  /** Link rastreado por cliente (?c=<customerId>): identifica quem abriu
      desde o primeiro segundo, antes de preencher qualquer dado. */
  customerId?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    term?: string | null;
    content?: string | null;
  };
  referer?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

export async function startSession(input: StartSessionInput) {
  // visitante: reutiliza ou cria anônimo
  let visitor = input.visitorId
    ? await db.visitor.findFirst({
        where: { id: input.visitorId, companyId: input.companyId },
      })
    : null;
  if (visitor) {
    visitor = await db.visitor.update({
      where: { id: visitor.id },
      data: { lastSeenAt: new Date(), visits: { increment: 1 } },
    });
  } else {
    visitor = await db.visitor.create({
      data: { companyId: input.companyId },
    });
  }

  // link rastreado: ?c=<customerId> identifica o visitante na entrada
  if (input.customerId) {
    const customer = await db.customer.findFirst({
      where: {
        companyId: input.companyId,
        OR: [{ linkCode: input.customerId }, { id: input.customerId }],
      },
      select: { id: true },
    });
    if (customer && visitor.customerId !== customer.id) {
      visitor = await db.visitor.update({
        where: { id: visitor.id },
        data: { customerId: customer.id },
      });
      await db.trackSession.updateMany({
        where: { visitorId: visitor.id },
        data: { customerId: customer.id },
      });
    }
  }

  // resolve o ref → vendedor ou campanha
  const ref = input.ref?.trim().toLowerCase() || null;
  let sellerId: string | null = null;
  let campaignId: string | null = null;
  let campaignChannel: string | null = null;
  if (ref) {
    const resolved = await resolveRef(input.companyId, ref);
    sellerId = resolved.sellerId;
    campaignId = resolved.campaignId;
    campaignChannel = resolved.campaignChannel;
  }

  const { device, os, browser } = parseUserAgent(input.userAgent);
  const session = await db.trackSession.create({
    data: {
      companyId: input.companyId,
      visitorId: visitor.id,
      customerId: visitor.customerId,
      ref,
      channel: classifyChannel({
        ref,
        utmSource: input.utm?.source,
        referer: input.referer,
        campaignChannel,
        isSeller: Boolean(sellerId && !campaignId),
      }),
      sellerId,
      campaignId,
      utmSource: input.utm?.source ?? null,
      utmMedium: input.utm?.medium ?? null,
      utmCampaign: input.utm?.campaign ?? null,
      utmTerm: input.utm?.term ?? null,
      utmContent: input.utm?.content ?? null,
      referer: input.referer?.slice(0, 300) ?? null,
      device,
      os,
      browser,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? "BR",
      ipMasked: maskIp(input.ip),
    },
  });

  return { visitorId: visitor.id, sessionId: session.id };
}

// ---- Eventos ---------------------------------------------------------------

export type TrackEventInput = {
  type: string;
  productId?: string;
  productName?: string;
  category?: string;
  color?: string;
  size?: string;
  qty?: number;
  value?: number;
  meta?: Record<string, unknown>;
};

const VALID_TYPES = new Set([
  "page_view", "category_view", "product_view", "image_zoom", "favorite",
  "color_select", "size_select", "qty_change", "cart_add", "cart_remove",
  "cart_open", "cart_close", "checkout_start", "order_submitted",
  "order_abandoned", "heartbeat", "session_end",
]);

/** Grava um lote de eventos de uma sessão (chamado pelo /api/track). */
export async function trackEvents(
  companyId: string,
  sessionId: string,
  events: TrackEventInput[]
) {
  const session = await db.trackSession.findFirst({
    where: { id: sessionId, companyId },
  });
  if (!session) return { ok: false as const, error: "Sessão inválida" };

  const valid = events.filter((e) => VALID_TYPES.has(e.type)).slice(0, 100);
  if (valid.length === 0) return { ok: true as const, stored: 0 };

  await db.trackEvent.createMany({
    data: valid.map((e) => ({
      companyId,
      sessionId,
      type: e.type,
      productId: e.productId,
      productName: e.productName,
      category: e.category,
      color: e.color,
      size: e.size,
      qty: e.qty,
      value: e.value,
      meta: e.meta ? JSON.stringify(e.meta) : null,
    })),
  });

  // agregados da sessão (dashboard rápido sem varrer eventos)
  const inc = (t: string) => valid.filter((e) => e.type === t).length;
  const lastCartValue = [...valid]
    .reverse()
    .find((e) => e.value !== undefined && ["cart_add", "cart_remove", "order_submitted"].includes(e.type))?.value;
  await db.trackSession.update({
    where: { id: session.id },
    data: {
      lastEventAt: new Date(),
      pages: { increment: inc("page_view") + inc("category_view") },
      productsViewed: { increment: inc("product_view") },
      cartAdds: { increment: inc("cart_add") },
      cartRemoves: { increment: inc("cart_remove") },
      ...(lastCartValue !== undefined ? { cartValue: lastCartValue } : {}),
      ...(valid.some((e) => e.type === "order_submitted")
        ? { converted: true }
        : {}),
    },
  });

  // fan-out para destinos futuros (Meta Pixel, GA4...) — hoje no-op
  forwardToDestinations(companyId, valid).catch(() => {});

  return { ok: true as const, stored: valid.length };
}

// ---- Identify (cliente anônimo → cliente real) ------------------------------

/** Unifica a navegação anônima quando o visitante informa o telefone. */
export async function identifyVisitor(
  companyId: string,
  visitorId: string,
  phone: string
) {
  const visitor = await db.visitor.findFirst({
    where: { id: visitorId, companyId },
  });
  if (!visitor) return { ok: false as const };

  const customer = await db.customer.findFirst({
    where: { companyId, phone: normalizePhone(phone) },
  });
  if (!customer) return { ok: true as const, linked: false };

  await db.visitor.update({
    where: { id: visitor.id },
    data: { customerId: customer.id },
  });
  await db.trackSession.updateMany({
    where: { visitorId: visitor.id },
    data: { customerId: customer.id },
  });
  return { ok: true as const, linked: true, customerId: customer.id };
}
