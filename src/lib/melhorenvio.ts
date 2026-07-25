import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { signState, verifyState } from "./nuvemshop"; // state assinado (HMAC)
import { appBaseUrl } from "./comm/evolution";

/**
 * Melhor Envio — módulo Envios (pago à parte, Company.shippingEnabled).
 *
 * A loja conecta a PRÓPRIA conta Melhor Envio (OAuth): a cotação, a compra da
 * etiqueta e o saldo são todos da conta dela — o AtacadoPro só orquestra.
 * Fluxo da etiqueta: cotar → carrinho → pagar (saldo ME) → gerar → imprimir.
 * Tokens sempre criptografados; renovação automática (token dura ~30 dias).
 */

const ME_BASE = process.env.MELHOR_ENVIO_SANDBOX
  ? "https://sandbox.melhorenvio.com.br"
  : "https://melhorenvio.com.br";
// o Melhor Envio exige identificação do app em toda chamada
const USER_AGENT = "AtacadoPro (atosrodriguesleite@gmail.com)";

export { signState, verifyState };

export function meEnv() {
  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim() || null;
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

export function meRedirectUri() {
  return `${appBaseUrl()}/api/melhorenvio/callback`;
}

/** URL de autorização: a lojista loga no Melhor Envio e autoriza a plataforma. */
export function meAuthorizeUrl(companyId: string) {
  const { clientId } = meEnv();
  const params = new URLSearchParams({
    client_id: clientId ?? "",
    redirect_uri: meRedirectUri(),
    response_type: "code",
    state: signState(companyId),
    scope: [
      "users-read",
      "shipping-calculate",
      "cart-read",
      "cart-write",
      "shipping-checkout",
      "shipping-generate",
      "shipping-print",
      "shipping-tracking",
      "shipping-cancel",
      "ecommerce-shipping",
    ].join(" "),
  });
  return `${ME_BASE}/oauth/authorize?${params}`;
}

type MeTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // segundos (~30 dias)
};

async function tokenRequest(body: Record<string, string>): Promise<MeTokens | null> {
  const { clientId, clientSecret } = meEnv();
  const res = await fetch(`${ME_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: meRedirectUri(),
      ...body,
    }),
  });
  const data = (await res.json().catch(() => null)) as MeTokens | null;
  return res.ok && data?.access_token ? data : null;
}

export async function meExchangeCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code });
}

export async function meSaveConnection(companyId: string, t: MeTokens) {
  const expiresAt = t.expires_in
    ? new Date(Date.now() + t.expires_in * 1000)
    : null;
  const dados = {
    accessToken: encryptSecret(t.access_token!),
    refreshToken: t.refresh_token ? encryptSecret(t.refresh_token) : null,
    expiresAt,
  };
  const conn = await db.melhorEnvioConnection.upsert({
    where: { companyId },
    update: dados,
    create: { companyId, ...dados },
  });
  // pré-preenche o remetente com os dados da conta ME (melhor esforço:
  // se a API mudar de formato, a lojista completa à mão em Configurações)
  if (!conn.fromName) await prefillSender(companyId, t.access_token!).catch(() => {});
  return conn;
}

/** Busca nome/documento/endereço na conta ME para preencher o remetente. */
async function prefillSender(companyId: string, token: string) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
  };
  const [meRes, addrRes] = await Promise.all([
    fetch(`${ME_BASE}/api/v2/me`, { headers }),
    fetch(`${ME_BASE}/api/v2/me/addresses`, { headers }),
  ]);
  const me = (await meRes.json().catch(() => null)) as {
    firstname?: string;
    lastname?: string;
    email?: string;
    document?: string; // CPF
    company_document?: string; // CNPJ
    phone?: { phone?: string } | string | null;
  } | null;
  const addrJson = (await addrRes.json().catch(() => null)) as unknown;
  const lista = Array.isArray(addrJson)
    ? addrJson
    : ((addrJson as { data?: unknown[] } | null)?.data ?? []);
  const a = (lista?.[0] ?? null) as {
    address?: string;
    number?: string | number;
    complement?: string | null;
    district?: string;
    postal_code?: string;
    city?: { city?: string; state?: { state_abbr?: string } } | string;
  } | null;
  const cidade = typeof a?.city === "object" ? a?.city : null;
  await db.melhorEnvioConnection.update({
    where: { companyId },
    data: {
      fromName: [me?.firstname, me?.lastname].filter(Boolean).join(" ") || null,
      fromDocument: me?.company_document || me?.document || null,
      fromEmail: me?.email ?? null,
      fromPhone:
        typeof me?.phone === "object" ? (me?.phone?.phone ?? null) : (me?.phone ?? null),
      fromZip: a?.postal_code ?? null,
      fromStreet: a?.address ?? null,
      fromNumber: a?.number != null ? String(a.number) : null,
      fromComplement: a?.complement ?? null,
      fromDistrict: a?.district ?? null,
      fromCity: (typeof a?.city === "string" ? a?.city : cidade?.city) ?? null,
      fromState: cidade?.state?.state_abbr ?? null,
    },
  });
}

/** Token válido da loja — renova sozinho quando faltam menos de 3 dias. */
async function meAccessToken(companyId: string): Promise<string | null> {
  const conn = await db.melhorEnvioConnection.findUnique({ where: { companyId } });
  if (!conn) return null;
  const vencePerto =
    conn.expiresAt && conn.expiresAt.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;
  if (vencePerto && conn.refreshToken) {
    const novo = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(conn.refreshToken),
    });
    if (novo?.access_token) {
      await meSaveConnection(companyId, novo);
      return novo.access_token;
    }
    // renovação falhou: tenta com o token atual (pode ainda valer)
  }
  return decryptSecret(conn.accessToken);
}

async function meApi<T = unknown>(
  companyId: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const token = await meAccessToken(companyId);
  if (!token) return { ok: false, status: 0, data: null, raw: "sem conexão" };
  const res = await fetch(`${ME_BASE}/api/v2${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    /* resposta sem JSON */
  }
  return { ok: res.ok, status: res.status, data, raw };
}

/** Mensagem de erro legível a partir da resposta do Melhor Envio. */
function meErro(data: unknown, status: number): string {
  const d = data as {
    error?: string;
    message?: string;
    errors?: Record<string, string[] | string>;
  } | null;
  const detalhes = d?.errors
    ? Object.values(d.errors)
        .map((v) => (Array.isArray(v) ? v.join("; ") : String(v)))
        .join(" ")
    : "";
  return (
    [d?.error ?? d?.message, detalhes].filter(Boolean).join(" — ").slice(0, 300) ||
    `O Melhor Envio recusou a chamada (HTTP ${status}).`
  );
}

/** Saldo da carteira Melhor Envio da loja (compra de etiqueta sai daí). */
export async function meBalance(companyId: string): Promise<number | null> {
  const r = await meApi<{ balance?: number | string }>(companyId, "GET", "/me/balance");
  if (!r.ok) return null;
  const n = Number(r.data?.balance ?? NaN);
  return Number.isFinite(n) ? n : null;
}

// ---- Peso do pedido --------------------------------------------------------

type ItemComPeso = {
  quantity: number;
  // produto pode ter sido apagado depois da venda (o item guarda snapshot)
  product: { weightGrams: number | null; category: string } | null;
};
type ConnPesos = {
  defaultWeightGrams: number;
  categoryWeights: string;
  boxWidthCm: number;
  boxHeightCm: number;
  boxLengthCm: number;
};

/**
 * Peso total do pedido em kg: peso do produto → padrão da categoria →
 * padrão da loja, nessa ordem. Nunca devolve zero (mínimo 0,05 kg).
 */
export function pesoDoPedidoKg(items: ItemComPeso[], conn: ConnPesos): number {
  let porCategoria: Record<string, number> = {};
  try {
    porCategoria = conn.categoryWeights ? JSON.parse(conn.categoryWeights) : {};
  } catch {
    porCategoria = {};
  }
  const gramas = items.reduce((soma, i) => {
    const daCategoria = i.product ? Number(porCategoria[i.product.category]) : 0;
    const peso =
      (i.product?.weightGrams && i.product.weightGrams > 0
        ? i.product.weightGrams
        : null) ??
      (daCategoria > 0 ? daCategoria : null) ??
      conn.defaultWeightGrams;
    return soma + i.quantity * peso;
  }, 0);
  return Math.max(0.05, Math.round(gramas) / 1000);
}

// ---- Cotação ----------------------------------------------------------------

export type MeQuote = {
  serviceId: number;
  service: string; // PAC, SEDEX, .Package...
  carrier: string; // Correios, Jadlog...
  carrierLogo: string | null;
  price: number;
  days: number | null; // prazo em dias úteis
};

/** Cota o frete de UMA caixa (peso somado do pedido + caixa padrão da loja). */
export async function meCalculate(input: {
  companyId: string;
  toZip: string;
  weightKg: number;
  insuranceValue: number;
}): Promise<{ ok: true; quotes: MeQuote[]; fromZip: string } | { ok: false; error: string }> {
  const conn = await db.melhorEnvioConnection.findUnique({
    where: { companyId: input.companyId },
  });
  if (!conn) return { ok: false, error: "Melhor Envio não conectado." };
  if (!conn.fromZip)
    return {
      ok: false,
      error: "Preencha o CEP do remetente em Configurações → Melhor Envio.",
    };
  const r = await meApi<
    {
      id?: number;
      name?: string;
      price?: string | number;
      delivery_time?: number;
      delivery_range?: { min?: number; max?: number };
      company?: { name?: string; picture?: string };
      error?: string;
    }[]
  >(input.companyId, "POST", "/me/shipment/calculate", {
    from: { postal_code: conn.fromZip.replace(/\D/g, "") },
    to: { postal_code: input.toZip.replace(/\D/g, "") },
    package: {
      weight: input.weightKg,
      width: conn.boxWidthCm,
      height: conn.boxHeightCm,
      length: conn.boxLengthCm,
    },
    options: {
      insurance_value: Math.round(input.insuranceValue * 100) / 100,
      receipt: false,
      own_hand: false,
    },
  });
  if (!r.ok || !Array.isArray(r.data))
    return { ok: false, error: meErro(r.data, r.status) };
  const quotes = r.data
    .filter((s) => !s.error && s.id && Number(s.price) > 0)
    .map((s) => ({
      serviceId: Number(s.id),
      service: s.name ?? "Serviço",
      carrier: s.company?.name ?? "",
      carrierLogo: s.company?.picture ?? null,
      price: Number(s.price),
      days: s.delivery_time ?? s.delivery_range?.max ?? null,
    }))
    .sort((a, b) => a.price - b.price);
  if (quotes.length === 0)
    return {
      ok: false,
      error:
        "Nenhuma transportadora atende este trecho/peso. Confira o CEP do cliente e o peso do pedido.",
    };
  return { ok: true, quotes, fromZip: conn.fromZip };
}

// ---- Compra da etiqueta ------------------------------------------------------

type Endereco = {
  name: string;
  document: string | null; // CPF/CNPJ (só dígitos)
  phone: string | null;
  email: string | null;
  zip: string;
  street: string;
  number: string;
  complement: string | null;
  district: string | null;
  city: string;
  state: string; // sigla
};

function pessoaME(e: Endereco) {
  const doc = (e.document ?? "").replace(/\D/g, "");
  return {
    name: e.name,
    phone: (e.phone ?? "").replace(/\D/g, "") || undefined,
    email: e.email || undefined,
    // CPF vai em `document`; CNPJ vai em `company_document`
    ...(doc.length === 14 ? { company_document: doc } : doc ? { document: doc } : {}),
    address: e.street,
    number: e.number || "S/N",
    complement: e.complement || undefined,
    district: e.district || undefined,
    city: e.city,
    state_abbr: e.state,
    country_id: "BR",
    postal_code: e.zip.replace(/\D/g, ""),
  };
}

/**
 * Compra a etiqueta de UM envio: carrinho → pagamento (saldo da carteira ME
 * da loja) → gerar etiqueta → link de impressão. Envio com DECLARAÇÃO DE
 * CONTEÚDO (non_commercial) — a NF-e pode ir junto fisicamente na caixa.
 */
export async function meBuyShipment(input: {
  companyId: string;
  serviceId: number;
  from: Endereco;
  to: Endereco;
  items: { name: string; quantity: number; unitPrice: number }[];
  weightKg: number;
  insuranceValue: number;
  orderLabel: string; // ex.: "Pedido #123" (aparece na sua conta ME)
}): Promise<
  | { ok: true; meOrderId: string; price: number; labelUrl: string | null; tracking: string | null }
  | { ok: false; error: string }
> {
  const conn = await db.melhorEnvioConnection.findUnique({
    where: { companyId: input.companyId },
  });
  if (!conn) return { ok: false, error: "Melhor Envio não conectado." };

  // 1) carrinho
  const cart = await meApi<{ id?: string; price?: string | number }>(
    input.companyId,
    "POST",
    "/me/cart",
    {
      service: input.serviceId,
      from: pessoaME(input.from),
      to: pessoaME(input.to),
      products: input.items.map((i) => ({
        name: i.name.slice(0, 250),
        quantity: i.quantity,
        unitary_value: Math.round(i.unitPrice * 100) / 100,
      })),
      volumes: [
        {
          weight: input.weightKg,
          width: conn.boxWidthCm,
          height: conn.boxHeightCm,
          length: conn.boxLengthCm,
        },
      ],
      options: {
        insurance_value: Math.round(input.insuranceValue * 100) / 100,
        receipt: false,
        own_hand: false,
        reverse: false,
        non_commercial: true, // declaração de conteúdo (imprimível no sistema)
        tags: [{ tag: input.orderLabel, url: null }],
      },
    }
  );
  if (!cart.ok || !cart.data?.id)
    return { ok: false, error: meErro(cart.data, cart.status) };
  const meOrderId = cart.data.id;

  // 2) pagamento com o saldo da carteira ME da loja
  const checkout = await meApi<{ purchase?: unknown }>(
    input.companyId,
    "POST",
    "/me/shipment/checkout",
    { orders: [meOrderId] }
  );
  if (!checkout.ok) {
    // desfaz o carrinho para não deixar lixo pendurado na conta da loja
    await meApi(input.companyId, "DELETE", `/me/cart/${meOrderId}`).catch(() => {});
    const msg = meErro(checkout.data, checkout.status);
    return {
      ok: false,
      error: /balance|saldo|insufficient/i.test(msg)
        ? "Saldo insuficiente na carteira Melhor Envio da loja. Adicione saldo em melhorenvio.com.br e tente de novo."
        : msg,
    };
  }

  // 3) gerar a etiqueta (libera impressão e rastreio)
  const gen = await meApi(input.companyId, "POST", "/me/shipment/generate", {
    orders: [meOrderId],
  });
  if (!gen.ok) return { ok: false, error: meErro(gen.data, gen.status) };

  // 4) link de impressão + rastreio (melhor esforço — dá para buscar depois)
  const [printR, trackR] = await Promise.all([
    meApi<{ url?: string }>(input.companyId, "POST", "/me/shipment/print", {
      mode: "private",
      orders: [meOrderId],
    }),
    meTracking(input.companyId, meOrderId),
  ]);
  const price = Number(cart.data.price ?? 0) || 0;
  return {
    ok: true,
    meOrderId,
    price,
    labelUrl: printR.data?.url ?? null,
    tracking: trackR?.tracking ?? null,
  };
}

/** Situação + código de rastreio de um envio comprado. */
export async function meTracking(
  companyId: string,
  meOrderId: string
): Promise<{ tracking: string | null; status: string | null } | null> {
  const r = await meApi<Record<string, { tracking?: string | null; status?: string }>>(
    companyId,
    "POST",
    "/me/shipment/tracking",
    { orders: [meOrderId] }
  );
  const info = r.data?.[meOrderId];
  if (!r.ok || !info) return null;
  return { tracking: info.tracking ?? null, status: info.status ?? null };
}

/** Link de impressão da etiqueta (pode ser pedido de novo a qualquer hora). */
export async function mePrintUrl(companyId: string, meOrderId: string) {
  const r = await meApi<{ url?: string }>(companyId, "POST", "/me/shipment/print", {
    mode: "private",
    orders: [meOrderId],
  });
  return r.data?.url ?? null;
}

/** Cancela um envio ainda não postado (o valor volta para a carteira ME). */
export async function meCancel(
  companyId: string,
  meOrderId: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await meApi(companyId, "POST", "/me/shipment/cancel", {
    order: { id: meOrderId, reason_id: "2", description: "Cancelado pela loja no AtacadoPro" },
  });
  return r.ok ? { ok: true } : { ok: false, error: meErro(r.data, r.status) };
}
