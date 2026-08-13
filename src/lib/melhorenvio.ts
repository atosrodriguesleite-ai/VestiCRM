import { db } from "./db";
import { limparChaveNfe } from "./bling";
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
      fromCpf: me?.document || null,
      fromCnpj: me?.company_document || null,
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

/**
 * IDs de TODOS os serviços do Melhor Envio (Correios + transportadoras).
 *
 * Por que isso existe: numa integração por API é QUEM CHAMA que diz quais
 * serviços quer na cotação. Sem a lista, o Melhor Envio devolve o conjunto
 * padrão dele — na conta do Atos vinham só SEDEX e PAC, e parecia que o
 * sistema não cotava transportadora nenhuma. Pedindo a lista inteira, cada
 * transportadora responde: ou com preço, ou com o motivo de não atender
 * (que a tela agora mostra).
 */
export function extrairServiceIds(data: unknown): number[] {
  // o Melhor Envio às vezes embrulha a lista em `{ data: [...] }` (o mesmo
  // vaivém que /me/addresses faz) — aceitar os dois evita voltar calado ao bug
  const lista = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: unknown })?.data)
      ? ((data as { data: unknown[] }).data)
      : [];
  return lista
    .map((s) => Number((s as { id?: unknown })?.id))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// A lista de serviços do Melhor Envio muda muito raramente (transportadora
// nova entra de tempos em tempos) — guardar por algumas horas evita uma
// chamada extra em toda cotação. Guardada POR LOJA: cada loja tem a conta ME
// dela, e lista de uma loja na cotação de outra é vazamento entre inquilinos.
const SERVICOS_TTL_MS = 60 * 60 * 1000;
const servicosCache = new Map<string, { ids: number[]; at: number }>();

/** Esquece a lista guardada — a loja trocou de conta Melhor Envio. */
export function meLimparCacheServicos(companyId: string) {
  servicosCache.delete(companyId);
}

async function meServiceIds(companyId: string): Promise<number[]> {
  const guardado = servicosCache.get(companyId);
  if (guardado && Date.now() - guardado.at < SERVICOS_TTL_MS) return guardado.ids;
  // Internet caindo no meio não pode derrubar a cotação: sem lista a gente
  // ainda cota o padrão da conta, e é isso que a lojista precisa ver.
  const r = await meApi(companyId, "GET", "/me/shipment/services").catch(
    (e: unknown) => ({ ok: false, status: 0, data: null, raw: String(e) })
  );
  const ids = r.ok ? extrairServiceIds(r.data) : [];
  if (!ids.length) {
    // Sem lista a cotação volta ao padrão da conta (só Correios) — falha
    // silenciosa é justamente o que escondeu esse bug por semanas.
    console.error(
      `[melhorenvio] lista de serviços vazia (status ${r.status}): ${r.raw.slice(0, 300)}`
    );
    return guardado?.ids ?? [];
  }
  servicosCache.set(companyId, { ids, at: Date.now() });
  return ids;
}

export type MeQuote = {
  serviceId: number;
  service: string; // PAC, SEDEX, .Package...
  carrier: string; // Correios, Jadlog...
  carrierLogo: string | null;
  price: number;
  days: number | null; // prazo em dias úteis
};

/** Transportadora que o Melhor Envio devolveu SEM preço, e o porquê. */
export type MeRecusa = {
  carrier: string;
  services: string[];
  reason: string;
};

/**
 * Traduz o "não cotou" do Melhor Envio para o português da lojista.
 *
 * Antes a gente simplesmente SUMIA com a transportadora que deu erro — a tela
 * mostrava só os Correios e ninguém sabia se era limite de peso, trecho sem
 * cobertura ou conta não liberada. Sumir com o motivo é o mesmo que esconder o
 * problema: a lojista fica achando que o sistema só cota Correios.
 */
export function motivoRecusa(erro: string): string {
  const e = erro.toLowerCase();
  // Causa nº 1 na prática: conta pessoa física / sem verificação. As
  // transportadoras privadas (Jadlog, Loggi, Azul, LATAM...) só liberam depois
  // que o Melhor Envio valida a conta — os Correios aceitam CPF de cara.
  // `inativ`/`token` ficam DE FORA de propósito: instabilidade da
  // transportadora ("serviço inativo") mandaria a lojista verificar uma conta
  // que já está verificada. Token ruim aparece como erro da chamada inteira.
  if (/contrato|habilit|autoriza|permiss|liberad|credencia/.test(e))
    return "Não liberada na sua conta Melhor Envio — faça a verificação da conta no painel deles.";
  if (/peso/.test(e)) return "Peso do pedido fora do limite dessa transportadora.";
  if (/dimens|altura|largura|comprimento|tamanho|cubagem/.test(e))
    return "Tamanho da caixa fora do limite dessa transportadora.";
  if (/cep|trecho|regi|atend|cobertura|rota|destino|origem/.test(e))
    return "Não atende este trecho (CEP de origem → destino).";
  if (/valor|seguro|declarado/.test(e))
    return "Valor do pedido fora do limite dessa transportadora.";
  return erro;
}

/** Cota o frete de UMA caixa (peso somado do pedido + caixa padrão da loja). */
export async function meCalculate(input: {
  companyId: string;
  toZip: string;
  weightKg: number;
  insuranceValue: number;
}): Promise<
  | { ok: true; quotes: MeQuote[]; recusadas: MeRecusa[]; fromZip: string }
  | { ok: false; error: string }
> {
  const conn = await db.melhorEnvioConnection.findUnique({
    where: { companyId: input.companyId },
  });
  if (!conn) return { ok: false, error: "Melhor Envio não conectado." };
  if (!conn.fromZip)
    return {
      ok: false,
      error: "Preencha o CEP do remetente em Configurações → Melhor Envio.",
    };
  const servicos = await meServiceIds(input.companyId);
  const cotar = (comServicos: boolean) =>
    meApi<
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
      from: { postal_code: conn.fromZip!.replace(/\D/g, "") },
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
      // sem isto o Melhor Envio devolve só o padrão da conta (SEDEX e PAC)
      ...(comServicos ? { services: servicos.join(",") } : {}),
    });

  let r = await cotar(servicos.length > 0);
  // Só repesca quando o Melhor Envio recusou o PEDIDO (400/422) — 401 (token),
  // 403 e 429 (limite) falhariam igual, e repetir só gastaria chamada.
  if (!r.ok && servicos.length > 0 && (r.status === 400 || r.status === 422)) {
    // Um id que o ME não aceita mais derrubaria a cotação INTEIRA e a loja
    // ficaria sem nem os Correios, que antes funcionavam. Repesca sem a lista:
    // volta ao padrão da conta, mas volta com alguma coisa.
    console.error(
      `[melhorenvio] calculate recusou a lista de serviços (${r.status}): ${r.raw.slice(0, 300)}`
    );
    // guarda a lista VAZIA: sem isso a próxima cotação buscaria os mesmos ids
    // e faria 3 chamadas para chegar no mesmo lugar, cotação após cotação
    servicosCache.set(input.companyId, { ids: [], at: Date.now() });
    r = await cotar(false);
  }
  if (!r.ok || !Array.isArray(r.data))
    return { ok: false, error: meErro(r.data, r.status) };
  const cotou = (s: (typeof r.data)[number]) =>
    !s.error && Boolean(s.id) && Number(s.price) > 0;
  const quotes = r.data
    .filter(cotou)
    .map((s) => ({
      serviceId: Number(s.id),
      service: s.name ?? "Serviço",
      carrier: s.company?.name ?? "",
      carrierLogo: s.company?.picture ?? null,
      price: Number(s.price),
      days: s.delivery_time ?? s.delivery_range?.max ?? null,
    }))
    .sort((a, b) => a.price - b.price);

  // Quem NÃO cotou vira uma linha explicada, agrupada por transportadora +
  // motivo (a Jadlog tem 3 serviços; 3 linhas iguais só poluiriam a tela).
  const porMotivo = new Map<string, MeRecusa>();
  for (const s of r.data) {
    if (cotou(s)) continue;
    const carrier = s.company?.name?.trim() || "Transportadora";
    // `error` vem de fora: já veio como texto sempre, mas se um dia vier
    // objeto o `.trim()` derrubaria a cotação INTEIRA — e aí nem os Correios
    // apareceriam. Só tratamos o que é texto de verdade.
    const bruto = typeof s.error === "string" ? s.error.trim() : "";
    const reason = bruto ? motivoRecusa(bruto) : "Sem preço para este envio.";
    const chave = `${carrier} \u0000 ${reason}`;
    const atual = porMotivo.get(chave);
    const service = s.name?.trim();
    if (atual) {
      if (service && !atual.services.includes(service)) atual.services.push(service);
    } else {
      porMotivo.set(chave, { carrier, services: service ? [service] : [], reason });
    }
  }
  const recusadas = [...porMotivo.values()].sort((a, b) =>
    a.carrier.localeCompare(b.carrier, "pt-BR")
  );

  // Só é erro quando o Melhor Envio não devolveu NADA — se ele explicou por
  // que cada uma recusou, a tela mostra a explicação em vez de um erro seco.
  if (quotes.length === 0 && recusadas.length === 0)
    return {
      ok: false,
      error:
        "Nenhuma transportadora atende este trecho/peso. Confira o CEP do cliente e o peso do pedido.",
    };
  return { ok: true, quotes, recusadas, fromZip: conn.fromZip };
}

// ---- Compra da etiqueta ------------------------------------------------------

type Endereco = {
  name: string;
  cpf: string | null; // só dígitos
  cnpj: string | null; // só dígitos
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
  // O Melhor Envio tem DOIS campos, e é por isso que o sistema guarda os dois
  // documentos: CPF vai em `document`, CNPJ em `company_document`. A loja
  // cliente costuma ter os dois (CNPJ da loja, CPF da titular) e algumas
  // transportadoras exigem um, outras o outro — mandando os dois, qualquer
  // uma aceita.
  const cpf = (e.cpf ?? "").replace(/\D/g, "");
  const cnpj = (e.cnpj ?? "").replace(/\D/g, "");
  return {
    name: e.name,
    phone: (e.phone ?? "").replace(/\D/g, "") || undefined,
    email: e.email || undefined,
    ...(cpf.length === 11 ? { document: cpf } : {}),
    ...(cnpj.length === 14 ? { company_document: cnpj } : {}),
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
 * Como o envio é declarado ao Melhor Envio: com NF-e (chave de acesso na
 * etiqueta) ou com declaração de conteúdo. Separado em função pura porque é
 * a decisão fiscal do envio — tem que dar para conferir sem chamar a API.
 */
export function opcoesFiscaisME(nfeKey: string | null | undefined): {
  non_commercial: boolean;
  invoice?: { key: string };
} {
  // chave torta derrubaria a COMPRA inteira; nesse caso é melhor a etiqueta
  // sair com declaração de conteúdo do que a loja ficar sem etiqueta
  const chave = limparChaveNfe(nfeKey);
  return chave
    ? { non_commercial: false, invoice: { key: chave } }
    : { non_commercial: true };
}

/**
 * Compra a etiqueta de UM envio: carrinho → pagamento (saldo da carteira ME
 * da loja) → gerar etiqueta → link de impressão.
 *
 * Com `nfeKey` (nota autorizada) a etiqueta sai COM a NF-e; sem chave, sai
 * com DECLARAÇÃO DE CONTEÚDO, que é o caso da maioria das lojas.
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
  /** Chave de acesso da NF-e (44 dígitos). Com ela a etiqueta sai COM nota. */
  nfeKey?: string | null;
}): Promise<
  | {
      ok: true;
      meOrderId: string;
      price: number;
      labelUrl: string | null;
      tracking: string | null;
      /** chave da NF-e que foi de fato usada (null = declaração de conteúdo) */
      nfeKey: string | null;
      /** pago (saldo debitado) mas a etiqueta ainda não gerou — precisa retomar */
      pendente?: boolean;
      aviso?: string;
    }
  | { ok: false; error: string }
> {
  const conn = await db.melhorEnvioConnection.findUnique({
    where: { companyId: input.companyId },
  });
  if (!conn) return { ok: false, error: "Melhor Envio não conectado." };
  const fiscal = opcoesFiscaisME(input.nfeKey);
  const chave = fiscal.invoice?.key ?? null;

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
        // `non_commercial: true` = "esse envio não tem nota, é declaração de
        // conteúdo". Com a chave da NF-e a gente inverte e manda a nota: a
        // etiqueta sai com a chave de acesso e a loja não preenche papel
        // nenhum. Sem chave, segue como sempre foi.
        ...fiscal,
        tags: [{ tag: input.orderLabel, url: null }],
      },
    }
  );
  if (!cart.ok || !cart.data?.id) {
    const msg = meErro(cart.data, cart.status);
    // Chave BEM FORMADA que o ME recusa (CNPJ da nota diferente do remetente
    // cadastrado, nota ainda não propagada na SEFAZ) — sem esta explicação a
    // loja lê "erro 422" e não faz ideia do que arrumar. Não trocamos por
    // declaração de conteúdo por conta própria: se existe nota, é a nota que
    // tem que viajar com a caixa.
    if (chave && /invoice|nota fiscal|nf-?e\b|chave de acesso/i.test(msg))
      return {
        ok: false,
        error: `${msg} Como este envio vai com nota fiscal, vale conferir se o CNPJ que emitiu a nota é o mesmo do remetente em Configurações → Melhor Envio, e se a nota foi autorizada há alguns minutos.`,
      };
    return { ok: false, error: msg };
  }
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

  const price = Number(cart.data.price ?? 0) || 0;

  // 3) gerar a etiqueta (libera impressão e rastreio).
  // CRÍTICO (auditoria 07/08/2026): o checkout ACIMA já debitou o saldo da
  // loja. Se o generate falhar, o dinheiro JÁ SAIU e o envio existe na conta
  // ME — devolver erro aqui fazia o pedido não gravar nada, e o retry
  // COMPRAVA OUTRA etiqueta. Então retornamos "pendente": a rota grava o
  // meOrderId (status GERANDO) e o retry retoma daqui (regenerar), sem
  // recomprar.
  const gen = await meApi(input.companyId, "POST", "/me/shipment/generate", {
    orders: [meOrderId],
  });
  if (!gen.ok) {
    return {
      ok: true,
      pendente: true,
      meOrderId,
      price,
      labelUrl: null,
      tracking: null,
      nfeKey: chave ?? null,
      aviso:
        "A etiqueta foi paga mas ainda não gerou. O valor não se perdeu — clique em 'Gerar etiqueta' de novo em instantes (não compre outra).",
    };
  }

  // 4) link de impressão + rastreio (melhor esforço — dá para buscar depois)
  const [printR, trackR] = await Promise.all([
    meApi<{ url?: string }>(input.companyId, "POST", "/me/shipment/print", {
      mode: "private",
      orders: [meOrderId],
    }),
    meTracking(input.companyId, meOrderId),
  ]);
  return {
    ok: true,
    meOrderId,
    price,
    labelUrl: printR.data?.url ?? null,
    tracking: trackR?.tracking ?? null,
    nfeKey: chave ?? null,
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

/**
 * RETOMA a geração de uma etiqueta JÁ PAGA que não gerou na compra (status
 * GERANDO). Não recompra nada — só chama generate + print no envio que já
 * existe na conta ME. É o par do "pendente" de meBuyShipment.
 */
export async function meRetomarEtiqueta(
  companyId: string,
  meOrderId: string
): Promise<
  | { ok: true; labelUrl: string | null; tracking: string | null }
  | { ok: false; error: string }
> {
  const gen = await meApi(companyId, "POST", "/me/shipment/generate", {
    orders: [meOrderId],
  });
  if (!gen.ok) return { ok: false, error: meErro(gen.data, gen.status) };
  const [printR, trackR] = await Promise.all([
    meApi<{ url?: string }>(companyId, "POST", "/me/shipment/print", {
      mode: "private",
      orders: [meOrderId],
    }),
    meTracking(companyId, meOrderId),
  ]);
  return { ok: true, labelUrl: printR.data?.url ?? null, tracking: trackR?.tracking ?? null };
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
