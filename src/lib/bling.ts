import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { signState, verifyState } from "./nuvemshop"; // state assinado (HMAC)
import { appBaseUrl } from "./comm/evolution";
import { orderNumber } from "./orders";

/**
 * Bling (ERP) — emissão de NF-e a partir do pedido.
 *
 * A nota é da LOJA: ela conecta a conta Bling dela (OAuth v3) e o AtacadoPro
 * monta e envia a NF-e pela API. Tokens criptografados, renovação automática
 * (access token do Bling dura ~6h; o refresh token renova sozinho).
 */

const BLING = "https://www.bling.com.br/Api/v3";

export { signState, verifyState };

export function blingEnv() {
  const clientId = process.env.BLING_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.BLING_CLIENT_SECRET?.trim() || null;
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

export function blingAuthorizeUrl(companyId: string) {
  const { clientId } = blingEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId ?? "",
    state: signState(companyId),
  });
  return `${BLING}/oauth/authorize?${params}`;
}

type BlingTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function tokenRequest(body: URLSearchParams): Promise<BlingTokens | null> {
  const { clientId, clientSecret } = blingEnv();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${BLING}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const data = (await res.json().catch(() => null)) as BlingTokens | null;
  return res.ok && data?.access_token ? data : null;
}

export async function blingExchangeCode(code: string) {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code })
  );
}

export async function blingSaveConnection(companyId: string, t: BlingTokens) {
  const expiresAt = new Date(Date.now() + (t.expires_in ?? 21600) * 1000);
  return db.blingConnection.upsert({
    where: { companyId },
    update: {
      accessToken: encryptSecret(t.access_token!),
      refreshToken: encryptSecret(t.refresh_token!),
      expiresAt,
    },
    create: {
      companyId,
      accessToken: encryptSecret(t.access_token!),
      refreshToken: encryptSecret(t.refresh_token!),
      expiresAt,
    },
  });
}

/** Token válido — renova sozinho quando falta menos de 10 min. */
async function blingAccessToken(companyId: string): Promise<string | null> {
  const conn = await db.blingConnection.findUnique({ where: { companyId } });
  if (!conn) return null;
  if (conn.expiresAt.getTime() - Date.now() < 10 * 60 * 1000) {
    const novo = await tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptSecret(conn.refreshToken),
      })
    );
    if (novo?.access_token) {
      await blingSaveConnection(companyId, novo);
      return novo.access_token;
    }
  }
  return decryptSecret(conn.accessToken);
}

async function blingApi<T = unknown>(
  companyId: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const token = await blingAccessToken(companyId);
  if (!token) return { ok: false, status: 0, data: null, raw: "sem conexão" };
  const res = await fetch(`${BLING}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text().catch(() => "");
  let data: T | null = null;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, raw: raw.slice(0, 500) };
}

/** Erro legível a partir da resposta do Bling (validações vêm detalhadas). */
function blingErro(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; fields?: { msg?: string }[] };
    };
    const campos = j.error?.fields?.map((f) => f.msg).filter(Boolean).join("; ");
    return (
      [j.error?.message, campos].filter(Boolean).join(" — ").slice(0, 300) ||
      `Bling recusou (HTTP ${status})`
    );
  } catch {
    return `Bling recusou (HTTP ${status})`;
  }
}

export type NfeResult =
  | { ok: true; blingId: string; situacao: string; numero?: string; url?: string }
  | { ok: false; error: string };

/**
 * Emite a NF-e do pedido: cria a nota no Bling e manda transmitir à SEFAZ.
 * Pré-requisitos (da LOJA, no cadastro do cliente): CPF/CNPJ e endereço.
 */
export async function emitirNfeDoPedido(
  companyId: string,
  orderId: string
): Promise<NfeResult> {
  const order = await db.order.findFirst({
    where: { id: orderId, companyId },
    include: { items: true, customer: true },
  });
  if (!order) return { ok: false, error: "Pedido não encontrado." };

  const c = order.customer;
  const doc = (c.document ?? "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    return {
      ok: false,
      error:
        "O cliente precisa ter CPF ou CNPJ preenchido na ficha para emitir a nota.",
    };
  }
  if (order.items.length === 0)
    return { ok: false, error: "Pedido sem itens." };

  // monta a NF-e (modelo 55, saída) no formato da API v3 do Bling
  const payload = {
    tipo: 1, // saída
    dataOperacao: new Date().toISOString().slice(0, 19).replace("T", " "),
    contato: {
      nome: c.name.slice(0, 120),
      tipoPessoa: doc.length === 14 ? "J" : "F",
      numeroDocumento: doc,
      ...(c.email ? { email: c.email } : {}),
      ...(c.phone ? { telefone: c.phone } : {}),
      endereco: {
        endereco: c.street ?? "",
        numero: c.streetNumber ?? "S/N",
        complemento: c.complement ?? "",
        bairro: c.district ?? "",
        cep: (c.zip ?? "").replace(/\D/g, ""),
        municipio: c.city ?? "",
        uf: c.state ?? "",
      },
    },
    itens: order.items.map((i) => ({
      codigo: i.sku ?? undefined,
      descricao: `${i.name} ${i.color} ${i.size}`.trim().slice(0, 120),
      unidade: "UN",
      quantidade: i.quantity,
      valor: i.unitPrice,
    })),
    observacoes: `Pedido ${orderNumber(order.number)} — AtacadoPro`,
  };

  const criada = await blingApi<{ data?: { id?: number | string } }>(
    companyId,
    "POST",
    "/nfe",
    payload
  );
  const blingId = criada.data?.data?.id ? String(criada.data.data.id) : null;
  if (!criada.ok || !blingId)
    return { ok: false, error: blingErro(criada.raw, criada.status) };

  // transmite à SEFAZ (autorização pode levar alguns segundos)
  const envio = await blingApi(companyId, "POST", `/nfe/${blingId}/enviar`, {});
  if (!envio.ok) {
    // nota criada mas não transmitida: guarda o id para reenviar/consultar
    await db.order.update({
      where: { id: order.id },
      data: { nfeBlingId: blingId, nfeStatus: "ERRO" },
    });
    return { ok: false, error: blingErro(envio.raw, envio.status) };
  }

  const consulta = await consultarNfe(companyId, blingId);
  await db.order.update({
    where: { id: order.id },
    data: {
      nfeBlingId: blingId,
      nfeStatus: consulta.situacao,
      nfeNumber: consulta.numero ?? null,
      nfeUrl: consulta.url ?? null,
    },
  });
  await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: "NOTA",
      description: `NF-e enviada ao Bling (situação: ${consulta.situacao})`,
    },
  });
  return { ok: true, blingId, ...consulta };
}

/** Consulta a situação da NF-e no Bling (número e link quando autorizada). */
export async function consultarNfe(
  companyId: string,
  blingId: string
): Promise<{ situacao: string; numero?: string; url?: string }> {
  const res = await blingApi<{
    data?: {
      situacao?: number;
      numero?: number | string;
      linkDanfe?: string;
      linkPDF?: string;
    };
  }>(companyId, "GET", `/nfe/${blingId}`);
  const d = res.data?.data;
  // situações do Bling: 1 pendente · 2 cancelada · 3 aguardando recibo ·
  // 4 rejeitada · 5 autorizada · 6 emitida DANFE · 7 registrada · ...
  const mapa: Record<number, string> = {
    1: "EMITINDO",
    2: "CANCELADA",
    3: "EMITINDO",
    4: "REJEITADA",
    5: "AUTORIZADA",
    6: "AUTORIZADA",
    7: "AUTORIZADA",
  };
  return {
    situacao: mapa[d?.situacao ?? 1] ?? "EMITINDO",
    numero: d?.numero ? String(d.numero) : undefined,
    url: d?.linkDanfe ?? d?.linkPDF ?? undefined,
  };
}
