import crypto from "crypto";
import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { intakeLead, normalizePhone } from "./intake";
import { round2 } from "./orders";
import { separarDocumento } from "./documento";
import { sincronizarPedidoSemQuebrar } from "./financeiro/porta-vendas";
import { notifySalePaid } from "./push";
import { winLinkedOpportunity, garantirCartaoDoPedido } from "./opportunity-sync";
import { comNumeroUnico } from "./numero-do-pedido";
import { limparDescricaoHtml, temEntidadeHtml } from "./descricao-limpa";

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

// estado do OAuth: sorteado, com validade, e conferido contra a sessão de
// quem volta do provedor (lib/oauth-state.ts) — o crachá fixo de antes podia
// ser reaproveitado por qualquer um, para sempre
export { signState, verifyState } from "./oauth-state";

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
      // Nuvemshop travada não pode segurar a função até a Vercel matá-la
      // (morte sem mensagem — vira "Não foi possível sincronizar" mudo)
      signal: AbortSignal.timeout(15_000),
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
  weight?: string | number | null; // kg (a Nuvemshop usa para calcular frete)
  image_id?: number | string | null; // foto da variação (capa por cor)
  values?: { pt?: string; es?: string; en?: string }[] | MultiLang[];
};
type NsProduct = {
  id: number | string;
  name: MultiLang;
  description?: MultiLang;
  published?: boolean;
  attributes?: MultiLang[];
  categories?: { name: MultiLang }[];
  images?: { id?: number | string; src: string; position?: number }[];
  variants?: NsVariant[];
};

/**
 * ESTOQUE "INFINITO" DA NUVEMSHOP: lá, `stock: null` significa "a loja não
 * controla a quantidade" (vende sempre). Nosso estoque é um número — o
 * espelho entra como 9999, que na prática nunca esgota (o catálogo mostra
 * disponível e a reserva sempre passa). Antes virava ZERO: o produto
 * aparecia esgotado aqui e, pior, a primeira venda local empurrava esse
 * número de volta e DESTRUÍA a configuração "infinito" da loja online
 * (auditoria 07/08/2026). Por isso `pushStockToNuvemshop` também NUNCA
 * devolve números na zona do infinito (>= 9000).
 */
const ESTOQUE_INFINITO = 9999;
const ZONA_INFINITO = 9000;
const estoqueNs = (v: NsVariant) =>
  v.stock == null ? ESTOQUE_INFINITO : Math.max(0, v.stock);

const num = (v: string | number | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? (n as number) : 0;
};

/** Peso em gramas a partir das variações (a Nuvemshop manda em kg). */
function pesoGramas(variants: NsVariant[]): number | null {
  const kg = variants.map((v) => num(v.weight)).find((x) => x > 0);
  return kg ? Math.round(kg * 1000) : null;
}

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

/**
 * CAPA POR COR (pedido da Entre Linhas, 03/08/2026): a Nuvemshop sabe qual
 * foto pertence a cada variação (`variant.image_id`) — a gente jogava essa
 * informação fora, e o catálogo mostrava a peça preta no card de toda cor.
 * Aqui vira o mapa foto(src) → cor. Foto usada por variações de CORES
 * DIFERENTES é ambígua e fica sem etiqueta (melhor capa geral que cor errada).
 */
export function coresPorFotoNs(p: NsProduct): Map<string, string> {
  const porImagem = new Map<string, Set<string>>();
  for (const v of p.variants ?? []) {
    if (v.image_id == null) continue;
    const { color } = corETamanho(p, v);
    if (!color || color === "Único") continue;
    const key = String(v.image_id);
    const set = porImagem.get(key) ?? new Set<string>();
    set.add(color);
    porImagem.set(key, set);
  }
  const out = new Map<string, string>();
  for (const img of p.images ?? []) {
    if (img.id == null) continue;
    const cores = porImagem.get(String(img.id));
    if (cores && cores.size === 1) out.set(img.src, [...cores][0]);
  }
  return out;
}

/**
 * Etiqueta as fotos JÁ importadas do produto local com a cor da Nuvemshop —
 * só onde ainda não há etiqueta (nunca sobrescreve escolha manual da lojista).
 * Foto subida à mão (data-URL) não casa com o src da Nuvemshop e fica como está.
 */
async function etiquetarFotosPorCor(productId: string, p: NsProduct) {
  const mapa = coresPorFotoNs(p);
  if (mapa.size === 0) return; // produto sem vínculo foto→variação: zero consultas
  // uma leitura só; grava apenas onde falta etiqueta (regime normal: nada a fazer)
  const semEtiqueta = await db.productImage.findMany({
    where: { productId, color: null, url: { in: [...mapa.keys()] } },
    select: { id: true, url: true },
  });
  for (const f of semEtiqueta) {
    const color = mapa.get(f.url);
    if (color) await db.productImage.update({ where: { id: f.id }, data: { color } });
  }
}

// normalização pra comparar nomes/SKUs sem pegadinha de acento/caixa
export const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
// "Baby Look — Branco" → base "Baby Look" (padrão produto-por-cor)
export const baseNome = (name: string) => name.replace(/\s+[—–-]\s+.+$/, "").trim();
/**
 * Duas cores são "a mesma" quando batem ou quando uma contém a outra
 * ("Off White" ↔ "White"). Serve para não confundir jeito de escrever com cor
 * diferente — e "Único" (loja sem atributo de cor) nunca conflita com nada.
 */
export const mesmaCor = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x === "unico" || y === "unico") return true;
  return x === y || x.includes(y) || y.includes(x);
};
export const corDoNome = (name: string) => {
  const m = name.match(/\s+[—–-]\s+(.+)$/);
  return m ? m[1].trim() : null;
};

/**
 * POOLS DA SINCRONIZAÇÃO — o porquê: `upsertProduct` consultava o catálogo
 * INTEIRO (todas as variações com SKU + todos os produtos) para CADA produto
 * da Nuvemshop. Com o catálogo crescendo, a sincronização completa passou de
 * 60s e a Vercel matava a função no meio ("Não foi possível sincronizar",
 * sem explicação — incidente Entre Linhas, 03/08/2026). A `syncProducts`
 * busca os pools UMA vez e repassa; o webhook (um produto só) segue buscando
 * na hora. Produto espelhado durante a rodada entra no pool em memória —
 * é o que impede duplicata se a paginação repetir o mesmo produto.
 */
const buscarPoolSku = (companyId: string) =>
  db.productVariant.findMany({
    where: { product: { companyId }, sku: { not: null } },
    include: { product: true },
  });
const buscarPoolProdutos = (companyId: string) =>
  db.product.findMany({
    where: { companyId },
    // description entra para a regra "nunca sobrescrever texto editado na loja"
    select: { id: true, name: true, sku: true, nuvemshopId: true, description: true },
  });
export type PoolsDeSync = {
  skuVariants: Awaited<ReturnType<typeof buscarPoolSku>>;
  allProducts: Awaited<ReturnType<typeof buscarPoolProdutos>>;
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
  report?: SyncReport,
  pools?: PoolsDeSync
) {
  const nsId = String(p.id);
  const nsName = texto(p.name).trim() || `Produto ${nsId}`;
  const variants = p.variants ?? [];

  // pools de candidatos locais (a sync completa passa os seus, buscados uma
  // vez — refazer estas consultas por produto era o que estourava os 60s)
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
    pools ? pools.skuVariants : buscarPoolSku(companyId),
    pools ? pools.allProducts : buscarPoolProdutos(companyId),
  ]);
  // SKU DUPLICADO NÃO CASA SOZINHO (incidente Toque Leve, 30/07/2026): com
  // duas variações locais usando o MESMO SKU, o mapa ficava com uma delas e o
  // casamento apontava para o produto errado em silêncio — foi assim que a
  // cor "Café" entrou dentro do produto Branco. SKU repetido é ambíguo: sai
  // do casamento automático e a variação vira pendência para a lojista
  // resolver. Vínculo já feito (nuvemshopId) continua valendo normalmente.
  const vezesPorSku = new Map<string, number>();
  for (const v of skuVariants) {
    const chave = norm(v.sku);
    vezesPorSku.set(chave, (vezesPorSku.get(chave) ?? 0) + 1);
  }
  const skuMap = new Map(
    skuVariants
      .filter((v) => vezesPorSku.get(norm(v.sku)) === 1)
      .map((v) => [norm(v.sku), v])
  );
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
    const stock = estoqueNs(v);
    const preco = num(v.price);

    // só casa por vínculo anterior OU por SKU (nunca por nome/cor)
    let alvo =
      linkedByNsVar.get(vId) ??
      (v.sku ? skuMap.get(norm(v.sku)) : undefined) ??
      null;

    // Variação NOVA (com SKU) num produto JÁ vinculado: entra sozinha no
    // produto certo. Se a cor+tamanho já existir nele, vincula; senão, cria.
    if (!alvo && v.sku && targetProductId) {
      // TRAVA DA COR (incidente Toque Leve, 30/07/2026): num catálogo
      // produto-por-cor ("Baby Look — Branco"), criar aqui uma variação de
      // OUTRA cor mistura duas peças numa só — soma o estoque das duas e faz o
      // catálogo mostrar um card a mais com a foto errada. Foi o que aconteceu
      // quando a cor nova "Café" entrou dentro do produto Branco (o SKU estava
      // duplicado e apontou pra lá). Cor nova em produto que declara cor no
      // nome NUNCA é criada: vira pendência pra lojista criar o produto certo.
      const nomeAlvo = allProducts.find((x) => x.id === targetProductId)?.name ?? "";
      const corDoProduto = corDoNome(nomeAlvo);
      if (corDoProduto && !mesmaCor(color, corDoProduto)) {
        if (report) {
          report.pendencias.push({
            produtoNs: `${nsName} (cor “${color}” não pertence a “${nomeAlvo}”)`,
            cor: color,
            tamanho: size,
            sku: v.sku ?? null,
          });
        }
        continue;
      }
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
        // estoque "infinito" não vira movimento: 9999 é espelho, não contagem
        if (stock > 0 && v.stock != null) {
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
    // registra o movimento — auditável e reversível (nunca sobrescreve sem
    // rastro). Estoque "infinito" fica de fora: o repor 9996 → 9999 de cada
    // sync viraria ruído sem significado no histórico.
    if (antes !== stock && v.stock != null) {
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
    // peso para frete (módulo Envios): entra sozinho da Nuvemshop, mas NUNCA
    // sobrescreve um peso já preenchido (à mão ou em sync anterior)
    const pesoNs = num(v.weight);
    if (pesoNs > 0 && !alvo.product.weightGrams) {
      await db.product.update({
        where: { id: alvo.product.id },
        data: { weightGrams: Math.round(pesoNs * 1000) },
      });
      alvo.product.weightGrams = Math.round(pesoNs * 1000);
    }
    if (report) report.casadas++;
  }

  // modo 1↔1: mantém também os dados do produto sincronizados
  if (um2um) {
    // DESCRIÇÃO — mesma regra do peso: o sync NUNCA sobrescreve texto
    // editado na loja. Antes ele reescrevia a cada rodada, e a lojista via a
    // edição "sumir e voltar" minutos depois (relato da Entre Linhas,
    // 06/08/2026). Só dois casos escrevem:
    //  • descrição local VAZIA → entra a da Nuvemshop, já limpa;
    //  • descrição local com "computês" (&ccedil; etc., gravado pelo sync
    //    antigo) → é limpa NO LUGAR, sem trocar o conteúdo.
    const descricaoLocal = um2um.description ?? "";
    const novaDescricao = !descricaoLocal.trim()
      ? limparDescricaoHtml(texto(p.description)) || undefined
      : temEntidadeHtml(descricaoLocal)
        ? limparDescricaoHtml(descricaoLocal)
        : undefined;
    await db.product.update({
      where: { id: um2um.id },
      data: {
        nuvemshopId: nsId,
        active: p.published !== false,
        ...(novaDescricao !== undefined ? { description: novaDescricao } : {}),
      },
    });
    const fotoCount = await db.productImage.count({ where: { productId: um2um.id } });
    if (fotoCount === 0 && p.images?.length) {
      const corDaFoto = coresPorFotoNs(p);
      await db.productImage.createMany({
        data: [...p.images]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .slice(0, 10)
          .map((img, i) => ({
            productId: um2um.id,
            url: img.src,
            order: i,
            color: corDaFoto.get(img.src) ?? null,
          })),
      });
    }
    // capa por cor: etiqueta as fotos já importadas (só onde falta etiqueta)
    await etiquetarFotosPorCor(um2um.id, p);
  } else if (targetProductId) {
    // produto casado por SKU/vínculo: fotos importadas da Nuvemshop também
    // ganham a etiqueta de cor (upload manual não casa por URL e fica intacto)
    await etiquetarFotosPorCor(targetProductId, p);
  }
  return null;
}

/** Espelho novo: produto que só existe na Nuvemshop entra completo. */
async function criarProdutoEspelhado(companyId: string, p: NsProduct) {
  const nsId = String(p.id);
  const name = texto(p.name).trim() || `Produto ${nsId}`;
  const category = texto(p.categories?.[0]?.name).trim() || "Loja online";
  // limpa também os códigos HTML (&ccedil; → ç) — só tirar as tags deixava
  // "Especifica&ccedil;&otilde;es" na cara da cliente final
  const description = limparDescricaoHtml(texto(p.description)) || null;
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
      weightGrams: pesoGramas(variants),
      active: p.published !== false,
    },
    include: { variants: true },
  });

  // fotos: só completa quando o produto ainda não tem (nunca sobrescreve).
  // Já nascem com a etiqueta de cor da Nuvemshop (capa por cor no catálogo).
  const fotoCount = await db.productImage.count({ where: { productId: product.id } });
  if (fotoCount === 0 && p.images?.length) {
    const corDaFoto = coresPorFotoNs(p);
    await db.productImage.createMany({
      data: [...p.images]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .slice(0, 10)
        .map((img, i) => ({
          productId: product.id,
          url: img.src,
          order: i,
          color: corDaFoto.get(img.src) ?? null,
        })),
    });
  }

  // grade: SÓ as variações COM SKU (sem SKU não integra); estoque da loja é a verdade
  for (const v of variants) {
    if (!(v.sku ?? "").trim()) continue;
    const vId = String(v.id);
    const { color, size } = corETamanho(p, v);
    const stock = estoqueNs(v);
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
    // registra a entrada no histórico (auditável) — infinito fica de fora
    if (stock > 0 && v.stock != null) {
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
  if (!conn) return { ok: false as const, produtos: 0, report: null, status: -1 };
  const report: SyncReport = { casadas: 0, criadas: 0, pendencias: [] };
  // catálogo local lido UMA vez para a rodada inteira (antes era por produto
  // — com o catálogo grande, estourava os 60s e a Vercel matava a função)
  const pools: PoolsDeSync = {
    skuVariants: await buscarPoolSku(companyId),
    allProducts: await buscarPoolProdutos(companyId),
  };
  let page = 1;
  let total = 0;
  for (; page <= 50; page++) {
    const res = await api<NsProduct[]>(conn, "GET", `/products?per_page=50&page=${page}`);
    // A PRIMEIRA página falhando não é "sincronizou zero": é a Nuvemshop
    // recusando a conversa (autorização vencida, limite, fora do ar). Antes
    // isso saía como sucesso com 0 produtos e ninguém entendia nada.
    if (!res.ok && page === 1) {
      return { ok: false as const, produtos: 0, report: null, status: res.status };
    }
    if (!res.ok || !res.data?.length) break;
    for (const p of res.data) {
      const criado = await upsertProduct(companyId, p, report, pools);
      // espelhado nesta rodada entra no pool: paginação que repetir o mesmo
      // produto encontra o vínculo em vez de criar duplicata
      if (criado) {
        pools.allProducts.push({
          id: criado.id,
          name: criado.name,
          sku: criado.sku,
          nuvemshopId: criado.nuvemshopId,
          description: criado.description,
        });
      }
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
  return { ok: true as const, produtos: total, report, status: 200 };
}

/**
 * SINCRONIZAÇÃO EM ETAPAS — incidente Entre Linhas (03/08/2026): a rodada
 * completa numa requisição só morria no limite de 60s da Vercel, sem
 * mensagem. Aqui cada chamada processa UMA página (50 produtos) e devolve se
 * acabou — a tela chama a próxima etapa e mostra o progresso. Não existe
 * catálogo grande o bastante para estourar: o tempo é sempre o de 50
 * produtos. O relatório vai sendo somado no banco a cada etapa (a etapa 1
 * zera), então "Conferir integração" continua contando a história inteira.
 */
export async function syncPaginaDeProdutos(companyId: string, page: number) {
  const conn = await loadConn(companyId);
  if (!conn) return { ok: false as const, produtos: 0, fim: true, status: -1 };
  const report: SyncReport = { casadas: 0, criadas: 0, pendencias: [] };
  const pools: PoolsDeSync = {
    skuVariants: await buscarPoolSku(companyId),
    allProducts: await buscarPoolProdutos(companyId),
  };
  // 25 por etapa: margem folgada mesmo com banco/Nuvemshop num dia lento
  const POR_ETAPA = 25;
  const res = await api<NsProduct[]>(
    conn,
    "GET",
    `/products?per_page=${POR_ETAPA}&page=${page}`
  );
  if (!res.ok && page === 1) {
    return { ok: false as const, produtos: 0, fim: true, status: res.status };
  }
  const lista = res.ok ? (res.data ?? []) : [];
  for (const p of lista) {
    const criado = await upsertProduct(companyId, p, report, pools);
    if (criado) {
      pools.allProducts.push({
        id: criado.id,
        name: criado.name,
        sku: criado.sku,
        nuvemshopId: criado.nuvemshopId,
        description: criado.description,
      });
    }
  }
  const fim = lista.length < POR_ETAPA || page >= 100;

  // soma o parcial desta etapa no relatório guardado (etapa 1 recomeça)
  const conexao = await db.nuvemshopConnection.findUnique({
    where: { companyId },
    select: { lastSyncReport: true },
  });
  let anterior = { casadas: 0, criadas: 0, pendencias: [] as SyncPendencia[] };
  if (page > 1 && conexao?.lastSyncReport) {
    try {
      const j = JSON.parse(conexao.lastSyncReport);
      anterior = {
        casadas: j.casadas ?? 0,
        criadas: j.criadas ?? 0,
        pendencias: Array.isArray(j.pendencias) ? j.pendencias : [],
      };
    } catch {
      // relatório antigo ilegível: recomeça do zero
    }
  }
  const somado = {
    at: new Date().toISOString(),
    casadas: anterior.casadas + report.casadas,
    criadas: anterior.criadas + report.criadas,
    pendencias: [...anterior.pendencias, ...report.pendencias].slice(0, 100),
  };
  await db.nuvemshopConnection.update({
    where: { companyId },
    data: {
      lastSyncReport: JSON.stringify(somado),
      ...(fim ? { lastProductSync: new Date() } : {}),
    },
  });

  return {
    ok: true as const,
    produtos: lista.length,
    fim,
    proximaPagina: page + 1,
    status: 200,
  };
}

/**
 * Variação como ela está NA NUVEMSHOP, achatada (produto + cor + tamanho +
 * SKU + estoque). Serve para CONFERIR o vínculo sem alterar nada — é a foto
 * do outro lado, para comparar com a nossa.
 */
export type VariacaoNs = {
  varId: string;
  prodId: string;
  produto: string;
  cor: string;
  tamanho: string;
  sku: string | null;
  estoque: number;
};

/**
 * Lê TODAS as variações da Nuvemshop (paginado), sem escrever uma linha no
 * banco. É o insumo da conferência de integração.
 */
export async function lerVariacoesNuvemshop(companyId: string) {
  const conn = await loadConn(companyId);
  if (!conn) return { ok: false as const, status: -1, variacoes: [] as VariacaoNs[], produtos: 0 };
  const variacoes: VariacaoNs[] = [];
  let produtos = 0;
  for (let page = 1; page <= 50; page++) {
    const res = await api<NsProduct[]>(conn, "GET", `/products?per_page=50&page=${page}`);
    if (!res.ok && page === 1) {
      return { ok: false as const, status: res.status, variacoes: [], produtos: 0 };
    }
    if (!res.ok || !res.data?.length) break;
    for (const p of res.data) {
      produtos++;
      const nome = texto(p.name).trim() || `Produto ${p.id}`;
      for (const v of p.variants ?? []) {
        const { color, size } = corETamanho(p, v);
        variacoes.push({
          varId: String(v.id),
          prodId: String(p.id),
          produto: nome,
          cor: color,
          tamanho: size,
          sku: (v.sku ?? "").trim() || null,
          // mesma régua do espelho: "infinito" (null) compara como 9999 —
          // senão a conferência acusava divergência falsa (9999 × 0)
          estoque: estoqueNs(v),
        });
      }
    }
    if (res.data.length < 50) break;
  }
  return { ok: true as const, status: 200, variacoes, produtos };
}

// ---- Vendas ----------------------------------------------------------------

type NsOrder = {
  id: number | string;
  number?: number;
  total?: string | number;
  subtotal?: string | number;
  shipping_cost_customer?: string | number; // frete que a cliente pagou
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
      // a Nuvemshop manda UM campo "identification": 14 dígitos é CNPJ, 11 é
      // CPF — cada um vai para a sua coluna, sem apagar o que já existe
      ...(() => {
        const d = separarDocumento(o.customer?.identification);
        return {
          ...(d.cpf && !atual?.cpf ? { cpf: d.cpf } : {}),
          ...(d.cnpj && !atual?.cnpj ? { cnpj: d.cnpj } : {}),
        };
      })(),
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
  // round2: soma de floats deixa centavo fantasma — o pedido espelhado tem
  // que bater com o valor da Nuvemshop
  const subtotal = round2(lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0));
  const total = round2(num(o.total)) || subtotal;
  // O total da Nuvemshop já vem COM frete. Separando os dois, o faturamento
  // aqui soma só a mercadoria — igual aos pedidos montados no sistema.
  const shippingFee = round2(Math.max(num(o.shipping_cost_customer), 0));
  const netTotal = round2(Math.max(total - shippingFee, 0));

  // A VENDA ONLINE FECHA O CARTÃO DO FUNIL.
  //
  // A cliente abandona o carrinho → nasce a oportunidade "🛒 Carrinho
  // abandonado". Depois ela volta e COMPRA. Como o pedido nascia sem vínculo,
  // o cartão continuava aberto e a vendedora ia cobrar quem já tinha pagado.
  // Mesma regra do pedido montado no sistema: negociação aberta mais recente
  // da cliente que ainda não tem pedido (o vínculo é 1-para-1).
  const negociacaoAberta = await db.opportunity.findFirst({
    where: { companyId, customerId, status: "OPEN", order: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  // comNumeroUnico: a venda online chega junto com pedido do painel/catálogo
  // e disputa o mesmo número — quem perde a corrida lê de novo e insiste
  const order = await comNumeroUnico(async () => {
    const last = await db.order.findFirst({
      where: { companyId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return db.order.create({
    data: {
      companyId,
      number: (last?.number ?? 0) + 1,
      customerId,
      opportunityId: negociacaoAberta?.id ?? null,
      status: "PAGO",
      source: "NUVEMSHOP",
      nuvemshopId: nsId,
      subtotal,
      shippingFee,
      netTotal,
      total,
      // já nasce pago: a data do dinheiro é agora (é ela que conta no mês)
      paidAt: new Date(),
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
          total: round2(l.quantity * l.unitPrice),
        })),
      },
    },
    });
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
  // marca a última compra do cliente (alimenta "inativos" e segmentação),
  // igual ao fluxo manual de pedido pago
  await db.customer.update({
    where: { id: customerId },
    data: { lastPurchaseAt: new Date(), lastContactAt: new Date() },
  });

  // O pedido já nasce PAGO (não passa pela transição de status), então o
  // fechamento do cartão precisa ser chamado aqui — igual faz o Pix em
  // `settle-order`. Venda da loja online sem negociação no funil ganha o
  // cartão FECHADO na hora. Nunca derruba a ingestão: engole os próprios erros.
  if (order.opportunityId) {
    await winLinkedOpportunity(companyId, order.opportunityId);
  } else {
    await garantirCartaoDoPedido(companyId, order.id);
  }

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

  // PORTA ÚNICA DO FINANCEIRO (RN-031): a venda da loja online vira
  // recebimento pela MESMA porta do pedido do sistema
  sincronizarPedidoSemQuebrar(order.id);

  return order;
}

/** Cancelamento na Nuvemshop → pedido espelhado vira CANCELADO. */
export async function ingestCancelledOrder(companyId: string, nsOrderId: string) {
  const order = await db.order.findUnique({
    where: { companyId_nuvemshopId: { companyId, nuvemshopId: String(nsOrderId) } },
  });
  if (!order || order.status === "CANCELADO") return;
  await db.order.update({ where: { id: order.id }, data: { status: "CANCELADO" } });
  // o cancelamento da loja online também passa pela porta (RN-031): o
  // recebimento automático é estornado e o lançamento, cancelado
  sincronizarPedidoSemQuebrar(order.id);
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

    const itensArr = (c.products ?? []).map(
      (p) => `${texto(p.name)} ×${Math.round(num(p.quantity)) || 1}`
    );
    const itens = itensArr.slice(0, 6).join(", "); // resumo curto pro título
    const detalhes = itensArr.join("\n") || null; // lista COMPLETA (uma por linha)
    const valor = num(c.total);

    // já existe: completa a lista de itens e o valor (backfill dos antigos que
    // vieram sem os produtos) e segue — sem duplicar a oportunidade.
    if (jaTem) {
      await db.opportunity.update({
        where: { id: jaTem.id },
        data: {
          details: detalhes,
          value: valor,
          title: `🛒 Carrinho abandonado (loja online)${itens ? ` — ${itens}` : ""}`,
        },
      });
      continue;
    }

    const fone = c.contact_phone ?? "";
    const email = c.contact_email ?? undefined;
    if (fone.replace(/\D/g, "").length < 8 && !email) continue; // sem contato, sem resgate

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
        details: detalhes,
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
    // espelho de estoque "infinito" (stock null na Nuvemshop): NÃO devolve —
    // empurrar 9996 para lá transformaria o "vende sempre" da loja num
    // número finito. Infinito nunca esgota; não há o que espelhar.
    if (v.stock >= ZONA_INFINITO) continue;
    await api(conn, "PUT", `/products/${nsProductId}/variants/${v.nuvemshopId}`, {
      stock: v.stock,
    });
  }
}
