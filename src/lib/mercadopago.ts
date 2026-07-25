import crypto from "crypto";
import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { signState, verifyState } from "./nuvemshop"; // state assinado (HMAC) — mesmo padrão
import { appBaseUrl } from "./comm/evolution";

/**
 * Mercado Pago — modo MARKETPLACE.
 *
 * A loja autoriza o app da plataforma (OAuth) e as cobranças Pix saem NA
 * CONTA DELA, já com a taxa da plataforma (application_fee) separada
 * automaticamente pelo próprio Mercado Pago — sem repasse manual.
 *
 * Regra comercial: taxa padrão da plataforma em PLATFORM_FEE_PCT (ex.: 0.5),
 * com possibilidade de valor específico por loja (feePercent na conexão).
 * Tokens SEMPRE criptografados no banco; renovação automática de token.
 */

const MP_API = "https://api.mercadopago.com";

export { signState, verifyState };

export function mpEnv() {
  const clientId = process.env.MP_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.MP_CLIENT_SECRET?.trim() || null;
  const feeDefault = Number(process.env.PLATFORM_FEE_PCT ?? "0.5");
  return {
    clientId,
    clientSecret,
    feeDefault: Number.isFinite(feeDefault) ? feeDefault : 0.5,
    configured: Boolean(clientId && clientSecret),
  };
}

export function mpRedirectUri() {
  return `${appBaseUrl()}/api/mercadopago/callback`;
}

/** URL de autorização: a lojista loga no MP e autoriza a plataforma. */
export function mpAuthorizeUrl(companyId: string) {
  const { clientId } = mpEnv();
  const params = new URLSearchParams({
    client_id: clientId ?? "",
    response_type: "code",
    platform_id: "mp",
    state: signState(companyId),
    redirect_uri: mpRedirectUri(),
  });
  return `https://auth.mercadopago.com.br/authorization?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  public_key?: string;
  user_id?: number | string;
  expires_in?: number; // segundos
};

/** Troca o code do OAuth pelos tokens do vendedor. */
export async function mpExchangeCode(code: string): Promise<TokenResponse | null> {
  const { clientId, clientSecret } = mpEnv();
  const res = await fetch(`${MP_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: mpRedirectUri(),
    }),
  });
  const data = (await res.json().catch(() => null)) as TokenResponse | null;
  return res.ok && data?.access_token ? data : null;
}

/** Salva/atualiza a conexão da loja (tokens criptografados). */
export async function mpSaveConnection(companyId: string, t: TokenResponse) {
  const expiresAt = t.expires_in
    ? new Date(Date.now() + t.expires_in * 1000)
    : null;
  const existing = await db.mercadoPagoConnection.findUnique({ where: { companyId } });
  const webhookToken = existing?.webhookToken ?? crypto.randomBytes(24).toString("hex");
  return db.mercadoPagoConnection.upsert({
    where: { companyId },
    update: {
      mpUserId: String(t.user_id ?? ""),
      accessToken: encryptSecret(t.access_token!),
      refreshToken: t.refresh_token ? encryptSecret(t.refresh_token) : null,
      publicKey: t.public_key ?? null,
      expiresAt,
    },
    create: {
      companyId,
      mpUserId: String(t.user_id ?? ""),
      accessToken: encryptSecret(t.access_token!),
      refreshToken: t.refresh_token ? encryptSecret(t.refresh_token) : null,
      publicKey: t.public_key ?? null,
      expiresAt,
      webhookToken,
    },
  });
}

/** Token válido da loja — renova sozinho quando está perto de vencer. */
async function mpAccessToken(companyId: string): Promise<string | null> {
  const conn = await db.mercadoPagoConnection.findUnique({ where: { companyId } });
  if (!conn) return null;
  const vencePerto =
    conn.expiresAt && conn.expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000;
  if (vencePerto && conn.refreshToken) {
    const { clientId, clientSecret } = mpEnv();
    const res = await fetch(`${MP_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: decryptSecret(conn.refreshToken),
      }),
    });
    const data = (await res.json().catch(() => null)) as TokenResponse | null;
    if (res.ok && data?.access_token) {
      await mpSaveConnection(companyId, data);
      return data.access_token;
    }
    // renovação falhou: tenta com o token atual mesmo (pode ainda valer)
  }
  return decryptSecret(conn.accessToken);
}

/** Taxa da plataforma para a loja (específica ou padrão global). */
export async function mpPlatformFeePercent(companyId: string): Promise<number> {
  const conn = await db.mercadoPagoConnection.findUnique({
    where: { companyId },
    select: { feePercent: true },
  });
  return conn?.feePercent ?? mpEnv().feeDefault;
}

type PixCharge = {
  mpPaymentId: string;
  copiaECola: string;
  qrBase64: string;
  feeAmount: number;
  expiresAt: Date;
};

/**
 * Cria a cobrança Pix na conta da LOJA, com a taxa da plataforma embutida
 * (application_fee). Vale por 24h. `externalRef` = id do pedido no sistema.
 */
export async function mpCreatePixCharge(input: {
  companyId: string;
  externalRef: string;
  amount: number;
  description: string;
  payerEmail?: string | null;
  payerName?: string | null;
}): Promise<{ ok: true; charge: PixCharge } | { ok: false; error: string }> {
  const token = await mpAccessToken(input.companyId);
  if (!token) return { ok: false, error: "Mercado Pago não conectado." };
  const conn = await db.mercadoPagoConnection.findUnique({
    where: { companyId: input.companyId },
  });
  const pct = conn?.feePercent ?? mpEnv().feeDefault;
  const feeAmount = Math.round(input.amount * pct) / 100; // pct% em reais
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [nome, ...resto] = (input.payerName ?? "Cliente").trim().split(/\s+/);
  const res = await fetch(`${MP_API}/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // repetir a chamada (retry) NUNCA pode gerar cobrança duplicada
      "X-Idempotency-Key": `${input.externalRef}-${input.amount.toFixed(2)}`,
    },
    body: JSON.stringify({
      transaction_amount: Math.round(input.amount * 100) / 100,
      description: input.description.slice(0, 250),
      payment_method_id: "pix",
      external_reference: input.externalRef,
      date_of_expiration: expiresAt.toISOString().replace("Z", "-00:00"),
      ...(feeAmount > 0 ? { application_fee: feeAmount } : {}),
      notification_url: `${appBaseUrl()}/api/mercadopago/webhook/${conn?.webhookToken}`,
      payer: {
        email:
          input.payerEmail?.trim() ||
          `pagador+${input.externalRef.slice(-8)}@atacadopro.com`,
        first_name: nome,
        last_name: resto.join(" ") || nome,
      },
    }),
  });
  const data = (await res.json().catch(() => null)) as {
    id?: number | string;
    point_of_interaction?: {
      transaction_data?: { qr_code?: string; qr_code_base64?: string };
    };
    message?: string;
  } | null;
  const qr = data?.point_of_interaction?.transaction_data;
  if (!res.ok || !data?.id || !qr?.qr_code) {
    return {
      ok: false,
      error:
        data?.message?.slice(0, 200) ??
        `O Mercado Pago recusou a cobrança (HTTP ${res.status}).`,
    };
  }
  return {
    ok: true,
    charge: {
      mpPaymentId: String(data.id),
      copiaECola: qr.qr_code,
      qrBase64: qr.qr_code_base64 ?? "",
      feeAmount,
      expiresAt,
    },
  };
}

/** Consulta o pagamento no MP (fonte da verdade na confirmação). */
export async function mpGetPayment(companyId: string, mpPaymentId: string) {
  const token = await mpAccessToken(companyId);
  if (!token) return null;
  const res = await fetch(`${MP_API}/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as {
    id?: number | string;
    status?: string; // approved | pending | rejected | cancelled...
    external_reference?: string;
  } | null;
}
