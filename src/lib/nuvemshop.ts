import crypto from "crypto";
import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { intakeLead, normalizePhone } from "./intake";
import { notifySalePaid } from "./push";

/**
 * Integração Nuvemshop — a loja online é a DONA do estoque e dos produtos;
 * o AtacadoPro espelha tudo e devolve as baixas do catálogo.
 *
 * Fluxos:
 *  • Conexão OAuth (app de parceiro): connect → autorização → callback → token
 *  • Importação/sincronização de produtos (idempotente; grade cor/tamanho)
 *  • Webhooks: venda paga vira pedido PAGO (source NUVEMSHOP) + cliente no
 *    CRM; produto criado/alterado atualiza o espelho; cancelamento reflete
 *  • Carrinhos abandonados: consulta periódica em segundo plano → lead +
 *    oportunidade no funil + tarefa de recuperação (deduplicado)
 *  • Estoque: Nuvemshop manda; quando o CATÁLOGO baixa estoque (pedido pago
 *    aqui), devolvemos a baixa pra lá — uma venda, uma baixa, sem divergir
 *
 * Segurança: token criptografado no banco; webhook validado por HMAC do
 * client secret; preços/valores sempre relidos da API (nunca do navegador).
 */

// ---- Configuração ----------------------------------------------------------

export function nuvemshopEnv() {
  const clientId = process.env.NUVEMSHOP_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET?.trim() || null;
  const apiBase =
    process.env.NUVEMSHOP_API_BASE?.trim().replace(/\/$/, "") ||
    "https://api.nuvemshop.com.br/v1";
  const authBase =
    process.env.NUVEMSHOP_AUTH_BASE?.trim().replace(/\/$/, "") ||
    "https://www.nuvemshop.com.br";
  return { clientId, clientSecret, apiBase, authBase, configured: Boolean(clientId && clientSecret) };
}

const UA = "AtacadoPro (integracao@atacadopro.com)";

// estado assinado do OAuth: prova que o retorno pertence à empresa que iniciou
export function signState(companyId: string) {
  const secret = process.env.AUTH_SECRET ?? "dev";
  const sig = crypto.createHmac("sha256", secret).update(companyId).digest("hex").slice(0, 24);
  return `${companyId}.${sig}`;
}
export function verifyState(state: string): string | null {
  const [companyId, sig] = state.split(".");
  if (!companyId || !sig) return null;
  return signState(companyId) === state ? companyId : null;
}

// ---- Cliente HTTP ----------------------------------------------------------

type Conn = { storeId: string; token: string };

async function api<T = unknown>(
  conn: Conn,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { apiBase } = nuvemshopEnv();
  try {
    const res = await fetch(`${apiBase}/${conn.storeId}${path}`, {
      method,
      headers: {
        Authentication: `bearer ${conn.token}`,
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export async function loadConn(companyId: string): Promise<Conn | null> {
  const c = await db.nuvemshopConnection.findUnique({ where: { companyId } });
  if (!c || c.status === "DESCONECTADO") return null;
  return { storeId: c.storeId, token: decryptSecret(c.accessToken) };
}

// ---- OAuth -----------------------------------------------------------------

export async function exchangeCode(code: string) {
  const { clientId, clientSecret, authBase } = nuvemshopEnv();
  const res = await fetch(`${authBase}/apps/authorize/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    user_id?: number | string;
  } | null;
  if (!res.ok || !data?.access_token || !data.user_id) return null;
  return { token: data.access_token, storeId: String(data.user_id) };
}

export async function saveConnection(companyId: string, storeId: string, token: string) {
  // loja online só pode estar ligada a UMA loja do AtacadoPro
  await db.nuvemshopConnection.deleteMany({
    where: { storeId, companyId: { not: companyId } },
  });
  return db.nuvemshopConnection.upsert({
    where: { companyId },
    update: { storeId, accessToken: encryptSecret(token), status: "CONECTADO" },
    create: { companyId, storeId, accessToken: encryptSecret(token) },
  });
}

/** Registra os webhooks (venda paga, cancelada, produto criado/alterado/apagado). */
export async function registerWebhooks(companyId: string) {
  const conn = await loadConn(companyId);
  if (!conn) return;
  const base = (process.env.APP_URL ?? process.env.MAIN_SITE_URL ?? "https://www.atacadopro.com").replace(/\/$/, "");
  const url = `${base}/api/nuvemshop/webhook`;
  const eventos = ["order/paid", "order/cancelled", "order/updated", "product/created", "product/updated", "product/deleted"];
  const existing = await api<{ id: number; event: string; url: string }[]>(conn, "GET", "/webhooks");
  const have = new Set((existing.data ?? []).filter((w) => w.url === url).map((w) => w.event));
  for (const event of eventos) {
    if (!have.has(event)) await api(conn, "POST", "/webhooks", { event, url });
  }
}

/** Valida a assinatura HMAC do webhook (x-linkedstore-hmac-sha256). */
export function verifyWebhook(rawBody: string, signature: string | null): boolean {
  const { clientSecret } = nuvemshopEnv();
  if (!clientSecret || !signature) return false;
  const mac = crypto.createHmac("sha256", clientSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---- Mapeamento de produtos ------------------------------------------------

type MultiLang = string | Record<string, string> | null | undefined;
const texto = (v: MultiLang): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v.pt ?? v.es ?? Object.values(v)[0] ?? "";
};

type NsVariant = {
  id: number | string;
  sku?: string | null;
  price?: string | number | null;
  stock?: number | null;
  values?: { pt?: string; es?: string; en?: string }[] | MultiLang[];
};
type NsProduct = {
  id: number | string;
  name: MultiLang;
  description?: MultiLang;
  published?: boolean;
  attributes?: MultiLang[];
  categories?: { name: MultiLang }[];
  images?: { src: string; position?: number }[];
  variants?: NsVariant[];
};

const num = (v: string | number | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? (n as number) : 0;
};

/** Descobre cor e tamanho da variação pelos nomes dos atributos do produto. */
function corETamanho(p: NsProduct, v: NsVariant): { color: string; size: string } {
  const attrs = (p.attributes ?? []).map((a) => texto(a).toLowerCase());
  const vals = (v.values ?? []).map((x) => texto(x as MultiLang));
  let color = "Único";
  let size = "Único";
  attrs.forEach((nome, i) => {
    const val = vals[i];
    if (!val) return;
    if (/cor|color/.test(nome)) color = val;
    else if (/tam|size|talle/.test(nome)) size = val;
  });
  // sem atributos nomeados: 1º valor = cor, 2º = tamanho (padrão comum)
  if (attrs.length === 0 && vals.length > 0) {
    color = vals[0] || "Único";
    size = vals[1] || "Único";
  }
  return { color, size };
}

// normalização pra comparar nomes/SKUs sem pegadinha de acento/caixa
export const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
// "Baby Look — Branco" → base "Baby Look" (padrão produto-por-cor)
export const baseNome = (name: string) => name.replace(/\s+[—–-]\s+.+$/, "").trim();
export const corDoNome = (name: string) => {
  const m = name.match(/\s+[—–-]\s+(.+)$/);
  return m ? m[1].trim() : null;
};

export type SyncPendencia = {
  produtoNs: string;
  cor: string;
  tamanho: string;
  sku: string | null;
};
export type SyncReport = {
  casadas: number;
  criadas: number;
  pendencias: SyncPendencia[];
};

/**
 * Cria/atualiza UM produto vindo da Nuvemshop (idempotente), casando em
 * CAMADAS — funciona com qualquer estrutura de catálogo:
 *   1. variação já vinculada (id da Nuvemshop)
 *   2. SKU DA VARIAÇÃO igual nos dois lados (chave universal)
 *   3. nome: mesmo produto ("Baby Look" ↔ "Baby Look") ou família
 *      produto-por-cor ("Baby Look" ↔ "Baby Look — Branco"), com a
 *      variação achada por cor+tamanho (sem diferença de acento/caixa)
 *   4. nada casou e a loja não tem nada parecido → produto novo espelhado
 * O que casar parcialmente NÃO cria duplicata: as variações órfãs entram no
 * relatório de pendências para o lojista resolver (preenchendo o SKU da
 * variação em Produtos).
 */
export async function upsertProduct(
  companyId: string,
  p: NsProduct,
  report?: SyncReport
) {
  const nsId = String(p.id);
  const nsName = texto(p.name).trim() || `Produto ${nsId}`;
  const variants = p.variants ?? [];

  // pools de candidatos locais
  const [linkedVariants, skuVariants, allProducts] = await Promise.all([
    db.productVariant.findMany({
      where: {
        product: { companyId },
        OR: [
          { nuvemshopId: { in: variants.map((v) => String(v.id)) } },
          { nuvemshopProductId: nsId },
        ],
      },
      include: { product: true },
    }),
    db.productVariant.findMany({
      where: { product: { companyId }, sku: { not: null } },
      include: { product: true },
    }),
    db.product.findMany({
      where: { companyId },
      select: { id: true, name: true, sku: true, nuvemshopId: true },
    }),
  ]);
  const skuMap = new Map(skuVariants.map((v) => [norm(v.sku), v]));
  // vínculo 1↔1 apenas quando JÁ existe ligação explícita (nuvemshopId)
  const um2um = allProducts.find((x) => x.nuvemshopId === nsId) ?? null;

  // REGRA DE SEGURANÇA: só integra por SKU (ou vínculo já existente). Nunca
  // casa por nome — foi o que duplicava e sobrescrevia estoque errado. Uma
  // variação SEM SKU nunca cria nem altera nada: vira pendência.
  const temMatchSku = variants.some((v) => v.sku && skuMap.has(norm(v.sku)));
  const temAlgumSku = variants.some((v) => (v.sku ?? "").trim());
  const temCandidato = linkedVariants.length > 0 || um2um !== null || temMatchSku;

  if (!temCandidato) {
    // produto genuinamente novo: só espelha se tiver SKU; senão fica pendente
    if (temAlgumSku) {
      const criado = await criarProdutoEspelhado(companyId, p);
      if (report) report.criadas++;
      return criado;
    }
    if (report) {
      for (const v of variants) {
        const { color, size } = corETamanho(p, v);
        report.pendencias.push({ produtoNs: nsName, cor: color, tamanho: size, sku: v.sku ?? null });
      }
    }
    return null;
  }

  const linkedByNsVar = new Map(linkedVariants.map((v) => [v.nuvemshopId, v]));

  // Produto local que este produto da Nuvemshop representa — já identificado
  // por vínculo (nuvemshopId) ou por SKU de alguma variação. Serve pra
  // ADICIONAR variações novas (cor/tamanho novo, com SKU) no produto certo,
  // SOZINHO — assim a lojista fica independente: cria a variação na Nuvemshop
  // e ela aparece aqui, sem virar pendência. Seguro porque o produto já está
  // 100% identificado (nunca cria PRODUTO por conta própria, só variação).
  const targetProductId =
    um2um?.id ??
    linkedVariants[0]?.productId ??
    variants
      .map((v) => (v.sku ? skuMap.get(norm(v.sku)) : undefined))
      .find((x): x is NonNullable<typeof x> => !!x)?.productId ??
    null;
  const targetVariants = targetProductId
    ? await db.productVariant.findMany({
        where: { productId: targetProductId },
        include: { product: true },
      })
    : [];
  const targetByCorTam = new Map(
    targetVariants.map((x) => [`${norm(x.color)}|${norm(x.size)}`, x])
  );

  for (const v of variants) {
    const vId = String(v.id);
    const { color, size } = corETamanho(p, v);
    const stock = Math.max(0, v.stock ?? 0);
    const preco = num(v.price);

    // só casa por vínculo anterior OU por SKU (nunca por nome/cor)
    let alvo =
      linkedByNsVar.get(vId) ??
      (v.sku ? skuMap.get(norm(v.sku)) : undefined) ??
      null;

    // Variação NOVA (com SKU) num produto JÁ vinculado: entra sozinha no
    // produto certo. Se a cor+tamanho já existir nele, vincula; senão, cria.
    if (!alvo && v.sku && targetProductId) {
      const existente = targetByCorTam.get(`${norm(color)}|${norm(size)}`);
      if (existente) {
        alvo = existente;
      } else {
        const nova = await db.productVariant.create({
          data: {
            productId: targetProductId,
            color,
            size,
            stock,
            sku: v.sku,
            nuvemshopId: vId,
            nuvemshopProductId: nsId,
          },
          include: { product: true },
        });
        if (stock > 0) {
          await db.inventoryMovement.create({
            data: {
              companyId,
              variantId: nova.id,
              type: "ENTRADA",
              quantity: stock,
              reason: "Nova variação (Nuvemshop)",
            },
          });
        }
        targetByCorTam.set(`${norm(color)}|${norm(size)}`, nova);
        if (report) report.casadas++;
        continue;
      }
    }

    if (!alvo) {
      if (report) {
        report.pendencias.push({ produtoNs: nsName, cor: color, tamanho: size, sku: v.sku ?? null });
      }
      continue;
    }

    const antes = alvo.stock;
    await db.productVariant.update({
      where: { id: alvo.id },
      data: {
        nuvemshopId: vId,
        nuvemshopProductId: nsId,
        stock,
        ...(v.sku && !alvo.sku ? { sku: v.sku } : {}),
      },
    });
    // registra o movimento — auditável e reversível (nunca sobrescreve sem rastro)
    if (antes !== stock) {
      await db.inventoryMovement.create({
        data: {
          companyId,
          variantId: alvo.id,
          type: "AJUSTE",
          quantity: Math.abs(stock - antes),
          reason: `Sincronização Nuvemshop (${antes} → ${stock})`,
        },
      });
    }
    // preço de varejo acompanha a loja online (o de atacado fica intacto)
    if (preco > 0 && alvo.product.retailPrice !== preco) {
      await db.product.update({
        where: { id: alvo.product.id },
        data: { retailPrice: preco },
      });
    }
    if (report) report.casadas++;
  }

  // modo 1↔1: mantém também os dados do produto sincronizados
  if (um2um) {
    await db.product.update({
      where: { id: um2um.id },
      data: {
        nuvemshopId: nsId,
        active: p.published !== false,
        ...(texto(p.description)
          ? {
              description: texto(p.description)
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
            }
          : {}),
      },
    });
    const fotoCount = await db.productImage.count({ where: { productId: um2um.id } });
    if (fotoCount === 0 && p.images?.length) {
      await db.productImage.createMany({
        data: [...p.images]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .slice(0, 10)
          .map((img, i) => ({ productId: um2um.id, url: img.src, order: i })),
      });
    }
  }
  return null;
}

/** Espelho novo: produto que só existe na Nuvemshop entra completo. */
async function criarProdutoEspelhado(companyId: string, p: NsProduct) {
  const nsId = String(p.id);
  const name = texto(p.name).trim() || `Produto ${nsId}`;
  const category = texto(p.categories?.[0]?.name).trim() || "Loja online";
  const description = texto(p.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
  const variants = p.variants ?? [];
  const retail = num(variants[0]?.price);
  const skuBase = (variants.find((v) => v.sku)?.sku ?? "").trim();
  const sku = skuBase || `NS-${nsId}`;

  const product = await db.product.create({
    data: {
      companyId,
      nuvemshopId: nsId,
      name,
      sku,
      category,
      description,
      retailPrice: retail,
      wholesalePrice: 0,
      minQuantity: 1,
      active: p.published !== false,
    },
    include: { variants: true },
  });

  // fotos: só completa quando o produto ainda não tem (nunca sobrescreve)
  const fotoCount = await db.productImage.count({ where: { productId: product.id } });
  if (fotoCount === 0 && p.images?.length) {
    await db.productImage.createMany({
      data: [...p.images]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .slice(0, 10)
        .map((img, i) => ({ productId: product.id, url: img.src, order: i })),
    });
  }

  // grade: SÓ as variações COM SKU (sem SKU não integra); estoque da loja é a verdade
  for (const v of variants) {
    if (!(v.sku ?? "").trim()) continue;
    const vId = String(v.id);
    const { color, size } = corETamanho(p, v);
    const stock = Math.max(0, v.stock ?? 0);
    const created = await db.productVariant.create({
      data: {
        productId: product.id,
        nuvemshopId: vId,
        nuvemshopProductId: nsId,
        sku: v.sku ?? null,
        color,
        size,
        stock,
      },
    });
    // registra a entrada no histórico (auditável)
    if (stock > 0) {
      await db.inventoryMovement.create({
        data: {
          companyId,
          variantId: created.id,
          type: "ENTRADA",
          quantity: stock,
          reason: "Importação Nuvemshop",
        },
      });
    }
  }
  return product;
}

/** Importação/sincronização completa de produtos (paginada), com relatório
 *  de vínculo: o que casou, o que entrou novo e as PENDÊNCIAS que precisam
 *  de ajuste manual (SKU da variação ou nome de cor/tamanho). */
export async function syncProducts(companyId: string) {
  const conn = await loadConn(companyId);
  if (!conn) return { ok: false as const, produtos: 0, report: null };
  const report: SyncReport = { casadas: 0, criadas: 0, pendencias: [] };
  let page = 1;
  let total = 0;
  for (; page <= 50; page++) {
    const res = await api<NsProduct[]>(conn, "GET", `/products?per_page=50&page=${page}`);
    if (!res.ok || !res.data?.length) break;
    for (const p of res.data) {
      await upsertProduct(companyId, p, report);
      total++;
    }
    if (res.data.length < 50) break;
  }
  await db.nuvemshopConnection.update({
    where: { companyId },
    data: {
      lastProductSync: new Date(),
      lastSyncReport: JSON.stringify({
        at: new Date().toISOString(),
        casadas: report.casadas,
        criadas: report.criadas,
        pendencias: report.pendencias.slice(0, 100),
      }),
    },
  });
  return { ok: true as const, produtos: total, report };
}

// ---- Vendas ----------------------------------------------------------------

type NsOrder = {
  id: number | string;
  number?: number;
  total?: string | number;
  subtotal?: string | number;
  payment_status?: string;
  status?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  customer?: { name?: string; email?: string; phone?: string; identification?: string };
  shipping_address?: {
    zipcode?: string;
    address?: string;
    number?: string;
    floor?: string; // complemento (apto, bloco…)
    locality?: string;
    city?: string;
    province?: string;
  };
  products?: {
    product_id: number | string;
    variant_id: number | string;
    name: MultiLang;
    quantity: number | string;
    price: string | number;
    sku?: string | null;
  }[];
};

/** Venda paga na Nuvemshop → pedido PAGO aqui + cliente no CRM + métricas. */
export async function ingestPaidOrder(companyId: string, nsOrderId: string) {
  const conn = await loadConn(companyId);
  if (!conn) return null;
  const res = await api<NsOrder>(conn, "GET", `/orders/${nsOrderId}`);
  const o = res.data;
  if (!res.ok || !o) return null;

  const nsId = String(o.id);
  const done = await db.order.findUnique({
    where: { companyId_nuvemshopId: { companyId, nuvemshopId: nsId } },
  });
  if (done) return done; // idempotente: webhook repetido não duplica

  // cliente no CRM (deduplicado por telefone; sem telefone usa e-mail no nome)
  const nome = o.customer?.name || o.contact_name || "Cliente da loja online";
  const fone = o.customer?.phone || o.contact_phone || "";
  const email = o.customer?.email || o.contact_email || undefined;
  let customerId: string;
  if (fone.replace(/\D/g, "").length >= 8) {
    const lead = await intakeLead(companyId, {
      phone: fone,
      name: nome,
      origin: "NUVEMSHOP",
      city: o.shipping_address?.city,
      state: o.shipping_address?.province,
      skipTask: true,
      skipOpportunity: true,
    });
    customerId = lead.customer.id;
  } else {
    const c = await db.customer.create({
      data: {
        companyId,
        name: nome,
        phone: `ns-${nsId}`,
        origin: "NUVEMSHOP",
      },
    });
    customerId = c.id;
  }
  // ficha completa: e-mail, CPF/CNPJ e endereço inteiro (sem apagar o que já
  // estiver preenchido na ficha)
  const atual = await db.customer.findUnique({ where: { id: customerId } });
  const end = o.shipping_address ?? {};
  await db.customer.update({
    where: { id: customerId },
    data: {
      ...(email && !atual?.email ? { email } : {}),
      ...(o.customer?.identification && !atual?.document
        ? { document: o.customer.identification }
        : {}),
      ...(end.zipcode && !atual?.zip ? { zip: end.zipcode } : {}),
      ...(end.address && !atual?.street ? { street: end.address } : {}),
      ...(end.number && !atual?.streetNumber ? { streetNumber: end.number } : {}),
      ...(end.floor && !atual?.complement ? { complement: end.floor } : {}),
      ...(end.locality && !atual?.district ? { district: end.locality } : {}),
      ...(end.city && !atual?.city ? { city: end.city } : {}),
      ...(end.province && !atual?.state ? { state: end.province } : {}),
    },
  });

  // itens ligados às variações espelhadas (vínculo por id da Nuvemshop)
  const lines: {
    productId: string | null;
    variantId: string | null;
    name: string;
    sku: string | null;
    color: string | null;
    size: string | null;
    quantity: number;
    unitPrice: number;
  }[] = [];
  for (const it of o.products ?? []) {
    const variant = await db.productVariant.findFirst({
      where: { nuvemshopId: String(it.variant_id), product: { companyId } },
      include: { product: true },
    });
    lines.push({
      productId: variant?.product.id ?? null,
      variantId: variant?.id ?? null,
      name: texto(it.name) || variant?.product.name || "Item",
      sku: it.sku ?? variant?.product.sku ?? null,
      color: variant?.color ?? null,
      size: variant?.size ?? null,
      quantity: Math.max(1, Math.round(num(it.quantity))),
      unitPrice: num(it.price),
    });
  }
  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const total = num(o.total) || subtotal;

  const last = await db.order.findFirst({
    where: { companyId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const order = await db.order.create({
    data: {
      companyId,
      number: (last?.number ?? 0) + 1,
      customerId,
      status: "PAGO",
      source: "NUVEMSHOP",
      nuvemshopId: nsId,
      subtotal,
      total,
      // estoque NÃO baixa aqui: a Nuvemshop já baixou (é a dona) — o espelho
      // chega pelo refresh abaixo. Uma venda, uma baixa.
      stockDeducted: true,
      notes: `Venda da loja online (Nuvemshop #${o.number ?? nsId})`,
      items: {
        create: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          name: l.name,
          sku: l.sku,
          color: l.color,
          size: l.size,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          total: l.quantity * l.unitPrice,
        })),
      },
    },
  });
  await db.customerEvent.create({
    data: {
      companyId,
      customerId,
      type: "PEDIDO",
      channel: "NUVEMSHOP",
      description: `Compra na loja online — R$ ${total.toFixed(2).replace(".", ",")}`,
    },
  });

  // espelha o estoque atual dos produtos vendidos (a baixa aconteceu lá)
  for (const pid of [...new Set((o.products ?? []).map((i) => String(i.product_id)))]) {
    const res2 = await api<NsProduct>(conn, "GET", `/products/${pid}`);
    if (res2.ok && res2.data) await upsertProduct(companyId, res2.data);
  }

  notifySalePaid(companyId, {
    id: order.id,
    number: order.number,
    total: order.total,
    customerName: nome,
  }).catch(() => {});

  return order;
}

/** Cancelamento na Nuvemshop → pedido espelhado vira CANCELADO. */
export async function ingestCancelledOrder(companyId: string, nsOrderId: string) {
  const order = await db.order.findUnique({
    where: { companyId_nuvemshopId: { companyId, nuvemshopId: String(nsOrderId) } },
  });
  if (!order || order.status === "CANCELADO") return;
  await db.order.update({ where: { id: order.id }, data: { status: "CANCELADO" } });
}

// ---- Carrinhos abandonados -------------------------------------------------

type NsCheckout = {
  id: number | string;
  total?: string | number;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  products?: { name: MultiLang; quantity: number | string }[];
};

/** Puxa os carrinhos abandonados → lead + card no funil + tarefa (dedupe). */
export async function syncAbandonedCheckouts(companyId: string) {
  const conn = await loadConn(companyId);
  if (!conn) return { novos: 0 };
  const res = await api<NsCheckout[]>(conn, "GET", "/checkouts?per_page=50");
  let novos = 0;
  for (const c of res.data ?? []) {
    const checkoutId = String(c.id);
    const jaTem = await db.opportunity.findUnique({
      where: {
        companyId_nuvemshopCheckoutId: { companyId, nuvemshopCheckoutId: checkoutId },
      },
    });
    if (jaTem) continue;
    const fone = c.contact_phone ?? "";
    const email = c.contact_email ?? undefined;
    if (fone.replace(/\D/g, "").length < 8 && !email) continue; // sem contato, sem resgate

    const itens = (c.products ?? [])
      .map((p) => `${texto(p.name)} ×${Math.round(num(p.quantity)) || 1}`)
      .slice(0, 6)
      .join(", ");
    const valor = num(c.total);

    let customerId: string;
    if (fone.replace(/\D/g, "").length >= 8) {
      const lead = await intakeLead(companyId, {
        phone: fone,
        name: c.contact_name || undefined,
        origin: "NUVEMSHOP",
        skipTask: true,
        skipOpportunity: true,
      });
      customerId = lead.customer.id;
      if (email && !lead.customer.email) {
        await db.customer.update({ where: { id: customerId }, data: { email } });
      }
    } else {
      const existente = email
        ? await db.customer.findFirst({ where: { companyId, email } })
        : null;
      customerId =
        existente?.id ??
        (
          await db.customer.create({
            data: {
              companyId,
              name: c.contact_name || email || "Cliente da loja online",
              phone: `ns-co-${checkoutId}`,
              email,
              origin: "NUVEMSHOP",
            },
          })
        ).id;
    }

    const stage = await db.stage.findFirst({
      where: { pipeline: { companyId } },
      orderBy: { order: "asc" },
    });
    if (!stage) continue;
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    await db.opportunity.create({
      data: {
        companyId,
        customerId,
        stageId: stage.id,
        nuvemshopCheckoutId: checkoutId,
        title: `🛒 Carrinho abandonado (loja online)${itens ? ` — ${itens}` : ""}`,
        value: valor,
        ownerId: customer?.ownerId ?? null,
        status: "OPEN",
      },
    });
    await db.task.create({
      data: {
        companyId,
        customerId,
        title: `Recuperar carrinho da loja online — ${customer?.name ?? "cliente"}`,
        type: "LIGAR",
        priority: "ALTA",
        dueAt: new Date(Date.now() + 60 * 60 * 1000),
        assigneeId: customer?.ownerId ?? null,
        autoRule: `ns-checkout:${checkoutId}`,
      },
    });
    novos++;
  }
  await db.nuvemshopConnection.update({
    where: { companyId },
    data: { lastCheckoutSync: new Date() },
  });
  return { novos };
}

/**
 * Sincronização preguiçosa em segundo plano: chamada ao abrir Funil/Dashboard;
 * só consulta a Nuvemshop se a última checagem tiver mais de 30 minutos.
 * Fire-and-forget — nunca atrasa a tela.
 */
export function maybeSyncNuvemshop(companyId: string) {
  (async () => {
    const c = await db.nuvemshopConnection.findUnique({ where: { companyId } });
    if (!c || c.status !== "CONECTADO") return;
    const stale = !c.lastCheckoutSync || Date.now() - c.lastCheckoutSync.getTime() > 30 * 60 * 1000;
    if (stale) await syncAbandonedCheckouts(companyId);
  })().catch(() => {});
}

// ---- Estoque: catálogo → Nuvemshop ----------------------------------------

/**
 * Baixa de estoque feita AQUI (pedido do catálogo pago) é devolvida pra
 * Nuvemshop, mantendo a dona do estoque em dia. Só variações vinculadas.
 */
export async function pushStockToNuvemshop(companyId: string, variantIds: string[]) {
  const conn = await loadConn(companyId);
  if (!conn || variantIds.length === 0) return;
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds }, nuvemshopId: { not: null }, product: { companyId } },
    include: { product: true },
  });
  for (const v of variants) {
    // modo produto-por-cor guarda o id do produto NS na própria variação
    const nsProductId = v.nuvemshopProductId ?? v.product.nuvemshopId;
    if (!nsProductId) continue;
    await api(conn, "PUT", `/products/${nsProductId}/variants/${v.nuvemshopId}`, {
      stock: v.stock,
    });
  }
}
