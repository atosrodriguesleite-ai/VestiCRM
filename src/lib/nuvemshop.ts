import crypto from "crypto";
import { after } from "next/server";
import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { intakeLead, normalizePhone } from "./intake";
import { round2 } from "./orders";
import { descartarSeparacaoAtiva, travarPedido } from "./etiquetas/separacao";
import { saiuDaFila } from "./etiquetas/separacao-regra";
import { separarDocumento } from "./documento";
import { sincronizarPedidoSemQuebrar } from "./financeiro/porta-vendas";
import { avisarVendaPagaSemQuebrar } from "./push";
import { winLinkedOpportunity, garantirCartaoDoPedido } from "./opportunity-sync";
import { comNumeroUnico } from "./numero-do-pedido";
import { limparDescricaoHtml, temEntidadeHtml } from "./descricao-limpa";
import { logServerError } from "./health";
import {
  MS_ORCAMENTO_REPESCA_ESTOQUE,
  confirmarEnvio,
  envioPendentePorVariacao,
  desistirDoEnvio,
  devolverTravaDaRepesca,
  marcarEnvioPendente,
  pecasParaRepescar,
  registrarFalhaDeEnvio,
  tomarTravaDaRepesca,
} from "./nuvemshop-estoque-pendente";
import { variacoesComEnvioPendente } from "./nuvemshop-estoque-pendente";
import {
  confirmarEnvioDePreco,
  desistirDoEnvioDePreco,
  precoPendentePorProduto,
  produtosComPrecoPendente,
  produtosParaRepescarPreco,
  registrarFalhaDePreco,
} from "./nuvemshop-preco-pendente";

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
/**
 * Texto "igual aos olhos" vira a MESMA chave: minúsculas, sem acento e com o
 * espaço arrumado. O `\s+ → " "` é o que salva o SKU digitado à mão (relato
 * da loja, 31/08/2026): "359003402Rosa  Chá" (dois espaços) e o espaço
 * INVISÍVEL que vem colado ao copiar da planilha (nbsp, U+00A0) rendiam
 * chaves diferentes e o estoque da Nuvemshop não puxava — sem nada na tela
 * explicando, porque para a lojista os dois textos são idênticos.
 */
export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // caractere de largura ZERO (vem colado ao copiar de planilha/site) SOME:
    // vira espaço, "Rosa<zwsp>Cha" viraria "rosa cha" e seguiria sem casar
    // com "RosaCha" — o defeito ficava escondido quando o invisível estava
    // na ponta, onde o trim() limpava (achado da revisão de 31/08/2026)
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    // espaço de verdade (inclusive o nbsp, que o \s não cobre em runtime
    // antigo) vira UM espaço só: "Rosa  Chá" = "Rosa Chá"
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
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
  /**
   * Índice dos SKUs "só letras e números" — montado UMA vez por sincronização
   * junto com os pools. Refazê-lo por produto custava um `normalize("NFD")`
   * por variação do catálogo inteiro a cada peça, na função que já morreu no
   * teto de 60s da Vercel uma vez (Entre Linhas, 03/08/2026).
   */
  idxParecidos: Map<string, string>;
  /** RN-057: produtos com varejo a caminho da Nuvemshop, lidos UMA vez por sync */
  precosPendentes?: Set<string>;
  /** RN-053: variações com baixa a caminho da Nuvemshop, lidas UMA vez por sync */
  estoquePendente?: Set<string>;
};

export type SyncPendencia = {
  produtoNs: string;
  cor: string;
  tamanho: string;
  sku: string | null;
  /**
   * SKU PARECIDO do nosso cadastro (relato da loja, 31/08/2026): a lojista
   * via "não casou" e não tinha como descobrir por quê — a tela mostrava só
   * o SKU da Nuvemshop, e comparar 12 dígitos + cor + tamanho a olho, entre
   * dois sistemas abertos, ninguém faz. Aqui vai o candidato mais próximo do
   * cadastro dela para ela ver a diferença (mesma ideia da RN-020: AVISA,
   * nunca junta sozinho — SKU parecido não é SKU igual).
   */
  skuParecido?: string | null;
  /**
   * O SKU é IGUAL ao do cadastro e mesmo assim não casou? Então ele está
   * REPETIDO em duas variações da loja — a trava de ambiguidade (incidente
   * Toque Leve) tira SKU repetido do casamento automático. O conselho é
   * outro: deixar o SKU único, não "igualar os dois".
   */
  repetido?: boolean;
  /**
   * O SKU está repetido em mais de uma variação do MESMO produto na
   * Nuvemshop (RN-072) — o conserto é lá: cada tamanho com o seu SKU.
   */
  repetidoLa?: boolean;
};
export type SyncReport = {
  casadas: number;
  criadas: number;
  pendencias: SyncPendencia[];
};

/**
 * O SKU do cadastro mais PARECIDO com o que veio da Nuvemshop — só para
 * EXPLICAR a pendência na tela, nunca para casar. "Parecido" = igual depois
 * de tirar tudo que não é letra ou número (espaço, hífen, ponto, barra): é
 * exatamente a diferença que o olho não vê e que trava o casamento.
 */
export const soLetrasENumeros = (v: string | null | undefined) =>
  norm(v).replace(/[^a-z0-9]/g, "");

/**
 * Índice dos SKUs do cadastro pela forma "só letras e números" — montado UMA
 * vez por sincronização. Antes a busca varria o pool inteiro por variação (3
 * `norm` por item): numa loja com milhares de peças eram segundos jogados
 * fora por página, e o teto de 60s da Vercel já mordeu a Entre Linhas uma vez.
 */
export function indiceDeSkusParecidos(
  poolDeSkus: { sku: string | null; product?: { name?: string } | null }[]
): Map<string, string> {
  const idx = new Map<string, string>();
  for (const v of poolDeSkus) {
    const k = soLetrasENumeros(v.sku);
    if (!k || !v.sku) continue;
    // o NOME do produto vai junto quando existe: "iguale os dois" só é bom
    // conselho se a lojista souber a QUAL peça o SKU parecido pertence —
    // sendo de outra peça, igualar criaria SKU duplicado (revisão 31/08/2026)
    const nome = v.product?.name?.trim();
    if (!idx.has(k)) idx.set(k, nome ? `${v.sku} (em “${nome}”)` : v.sku);
  }
  return idx;
}

/**
 * O par `sku` + pista para a pendência, num lugar só. A guarda do VAZIO é o
 * que impede a variação SEM SKU de sair marcada como "repetido" ("" === ""
 * dava true — achado da revisão 31/08/2026).
 */
export function pistaDoSku(
  sku: string | null | undefined,
  idx: Map<string, string> | { sku: string | null; product?: { name?: string } | null }[]
): { sku: string | null; skuParecido: string | null; repetido: boolean } {
  const bruto = (sku ?? "").trim();
  if (!bruto) return { sku: null, skuParecido: null, repetido: false };
  const parecido = skuParecidoNoCadastro(bruto, idx);
  // o rótulo pode trazer ' (em "Peça")' junto — a comparação é do SKU puro
  const soOSku = (parecido ?? "").replace(/\s*\(em .*\)$/, "");
  return {
    sku: bruto,
    skuParecido: parecido,
    repetido: !!parecido && norm(soOSku) === norm(bruto),
  };
}

/**
 * QUEM DE LÁ FICA COM QUAL PEÇA DAQUI — UMA PEÇA DAQUI ESPELHA UMA DE LÁ
 * (RN-072, 07/10/2026). Regra pura, testada sem banco.
 *
 * Relato do dono com o print da Regata Quadrada: na Nuvemshop, os tamanhos
 * P, M, G e GG da Azul Marinho estavam TODOS com o SKU "RQD-MAR-P" (a
 * Nuvemshop copia o SKU ao montar a grade, e ninguém percebe). Aqui só a P
 * tinha esse SKU, então as quatro de lá casavam com ela, uma depois da outra,
 * na MESMA rodada — a última lida ganhava: a P daqui mostrava o estoque de
 * outro tamanho, os outros ficavam zerados, e toda venda da P daqui ia avisar
 * a Nuvemshop na peça ERRADA (RN-053).
 *
 * A escolha é feita ANTES do laço, de uma vez, e cada peça daqui é alvo de
 * UMA variação de lá por rodada, nesta ordem de confiança:
 *  1. o VÍNCULO que um SKU confiável confirma (ou que nenhum SKU contradiz);
 *  2. o SKU que aparece UMA vez só no produto de lá — mas sem tirar de outro
 *     produto de lá a peça que é dele, quando a variação de lá já tem vínculo
 *     próprio (era assim antes: o vínculo vinha primeiro);
 *  3. para SKU REPETIDO lá, a COR × TAMANHO do produto já identificado — SKU
 *     repetido não confirma nada, então nem casa por SKU nem segura vínculo
 *     velho; nunca toma peça que é de OUTRO produto de lá;
 *  4. o vínculo que sobrou (contradito pelo SKU ou apoiado num SKU
 *     repetido), se a peça ficou livre — quem trocou o SKU só lá segue com o
 *     estoque espelhado, como sempre foi.
 *
 * Sem essa ordem, o mapa de vínculos (a foto do começo da rodada) puxava de
 * volta a peça que outro par já tinha levado — e corrigir o SKU lá não
 * bastava: a P casava com a P de lá pelo SKU e voltava para a M pelo vínculo
 * velho no mesmo laço. A ordem em que a Nuvemshop devolve as variações não
 * muda mais o resultado.
 */
export type VariacaoDeLaParaCasar = {
  id: string;
  sku?: string | null;
  /** cor × tamanho normalizados, ou null quando a trava da cor barra */
  corTam: string | null;
};
export type PecaDaquiParaCasar = {
  id: string;
  sku: string | null;
  nuvemshopId: string | null;
  nuvemshopProductId: string | null;
};

/**
 * Os SKUs (normalizados) que aparecem em MAIS DE UMA variação da lista — a
 * régua única do "SKU repetido lá" (RN-072): a sincronização, o produto
 * espelhado e a conferência contam pelo mesmo lugar.
 */
export function skusRepetidos(variacoes: { sku?: string | null }[]): Set<string> {
  const vezes = new Map<string, number>();
  for (const v of variacoes) {
    const k = norm(v.sku);
    if (k) vezes.set(k, (vezes.get(k) ?? 0) + 1);
  }
  return new Set([...vezes].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * A peça daqui já espelha OUTRO produto de lá (vínculo vivo que não é desta
 * rodada)? Tomá-la faria os dois produtos de lá escreverem nela, um em cada
 * sincronização. Vínculo antigo sem o produto de lá conhecido não conta
 * (era assim antes: sem saber, o casamento segue).
 */
export function espelhaOutroProduto(
  p: Pick<PecaDaquiParaCasar, "nuvemshopId" | "nuvemshopProductId">,
  nsProductId: string,
  idsDaRodada: Set<string>
): boolean {
  return (
    !!p.nuvemshopId &&
    !idsDaRodada.has(p.nuvemshopId) &&
    !!p.nuvemshopProductId &&
    p.nuvemshopProductId !== nsProductId
  );
}

export function escolherAlvos<T extends PecaDaquiParaCasar>(entrada: {
  nsProductId: string;
  variacoesDeLa: VariacaoDeLaParaCasar[];
  vinculadas: Map<string | null, T>;
  porSku: Map<string, T>;
  /** as variações do produto daqui já identificado, por cor × tamanho */
  porCorTam: Map<string, T>;
}): { alvos: Map<string, T>; ocupadas: Set<string>; skuRepetidoLa: Set<string> } {
  const { nsProductId, variacoesDeLa, vinculadas, porSku, porCorTam } = entrada;
  const skuRepetidoLa = skusRepetidos(variacoesDeLa);
  const repetido = (v: VariacaoDeLaParaCasar) => skuRepetidoLa.has(norm(v.sku));
  // a peça daqui que já espelha OUTRO produto de lá (vínculo vivo de fora
  // desta rodada) — tomá-la faria os dois produtos de lá brigarem por ela
  const idsDaRodada = new Set(variacoesDeLa.map((v) => v.id));
  const deOutroProduto = (p: T) => espelhaOutroProduto(p, nsProductId, idsDaRodada);

  const alvos = new Map<string, T>();
  const ocupadas = new Set<string>();
  const ocupar = (v: VariacaoDeLaParaCasar, peca: T | undefined) => {
    if (!peca || alvos.has(v.id) || ocupadas.has(peca.id)) return;
    alvos.set(v.id, peca);
    ocupadas.add(peca.id);
  };
  const confirma = (v: VariacaoDeLaParaCasar, peca: T) => {
    // SKU repetido lá não confirma vínculo nenhum — nem quando a peça daqui
    // não tem SKU (senão o vínculo velho passava na frente da cor × tamanho)
    if (repetido(v)) return false;
    const a = norm(v.sku);
    const b = norm(peca.sku);
    return !a || !b || a === b;
  };

  // 1º o vínculo confirmado
  for (const v of variacoesDeLa) {
    const peca = vinculadas.get(v.id);
    if (peca && confirma(v, peca)) ocupar(v, peca);
  }
  // 2º o SKU único no produto de lá
  for (const v of variacoesDeLa) {
    const k = norm(v.sku);
    if (!k || repetido(v)) continue;
    const peca = porSku.get(k);
    if (peca && deOutroProduto(peca) && vinculadas.has(v.id)) continue;
    ocupar(v, peca);
  }
  // 3º SKU repetido lá: a cor × tamanho do produto identificado
  for (const v of variacoesDeLa) {
    if (!repetido(v) || !v.corTam) continue;
    const peca = porCorTam.get(v.corTam);
    if (peca && !deOutroProduto(peca)) ocupar(v, peca);
  }
  // 4º o vínculo que sobrou
  for (const v of variacoesDeLa) ocupar(v, vinculadas.get(v.id));

  return { alvos, ocupadas, skuRepetidoLa };
}

export function skuParecidoNoCadastro(
  skuDaNuvemshop: string | null | undefined,
  poolOuIndice: { sku: string | null }[] | Map<string, string>
): string | null {
  const alvo = soLetrasENumeros(skuDaNuvemshop);
  if (!alvo) return null;
  const idx = poolOuIndice instanceof Map ? poolOuIndice : indiceDeSkusParecidos(poolOuIndice);
  const achado = idx.get(alvo) ?? null;
  if (!achado) return null;
  // IGUAL de verdade também conta como "parecido" quando NÃO casou: o SKU
  // repetido em duas variações sai do casamento automático (trava da Toque
  // Leve) — se ali devolvêssemos null, a peça viraria espelho duplicado sem
  // uma linha de aviso, justo no caso mais óbvio (achado da revisão 31/08).
  return achado;
}

/**
 * Guarda pendências no relatório da conexão mesmo quando NÃO existe um
 * `report` de sincronização em curso — é o caso do webhook e da baixa de
 * estoque da venda paga. Sem isto o produto barrado pela trava do SKU
 * quase-igual não era criado E não aparecia em lugar nenhum: sumia em
 * silêncio até alguém clicar em sincronizar (achado da revisão 31/08/2026).
 * A varredura de carona no tráfego só cuida de carrinhos, não de produtos.
 */
async function registrarPendenciasAvulsas(
  companyId: string,
  novas: SyncPendencia[]
): Promise<void> {
  if (novas.length === 0) return;
  const conexao = await db.nuvemshopConnection.findUnique({
    where: { companyId },
    select: { lastSyncReport: true },
  });
  let atual: {
    at?: string;
    casadas?: number;
    criadas?: number;
    totalPendencias?: number;
    pendencias?: SyncPendencia[];
  } = {};
  try {
    if (conexao?.lastSyncReport) atual = JSON.parse(conexao.lastSyncReport);
  } catch {
    /* relatório antigo ilegível: recomeça deste */
  }
  const antes = Array.isArray(atual.pendencias) ? atual.pendencias : [];
  // o webhook chega a cada mudança do produto lá: a mesma pendência não entra
  // duas vezes (senão a lista enchia de cópias e o total crescia sem fim)
  // A MESMA peça com conselho novo (ex.: "repetido LÁ" no lugar do antigo
  // "repetido aqui") TROCA o conselho, em vez de ser barrada pela antiga
  const chave = (x: SyncPendencia) => [x.produtoNs, x.cor, x.tamanho, x.sku ?? ""].join("|");
  const novaPorChave = new Map(novas.map((x) => [chave(x), x]));
  const atualizadas = antes.map((x) => novaPorChave.get(chave(x)) ?? x);
  const jaListadas = new Set(antes.map(chave));
  const ineditas = novas.filter((x) => !jaListadas.has(chave(x)));
  const mudou = atualizadas.some((x, i) => x !== antes[i] && JSON.stringify(x) !== JSON.stringify(antes[i]));
  // lista cheia: não dá para saber se a nova já está entre as que ficaram de
  // fora, e somar no total a cada aviso o faria crescer sem fim — a próxima
  // sincronização completa refaz a conta inteira
  const entram = antes.length >= 100 ? [] : ineditas;
  if (entram.length === 0 && !mudou) return;
  await db.nuvemshopConnection
    .update({
      where: { companyId },
      data: {
        lastSyncReport: JSON.stringify({
          ...atual,
          // `at`, `casadas` e `criadas` NÃO mudam: a conferência foi a de
          // antes — quem mudou foi a lista de pendências
          totalPendencias: (atual.totalPendencias ?? antes.length) + entram.length,
          pendencias: [...atualizadas, ...entram].slice(0, 100),
        }),
      },
    })
    .catch(() => {});
}

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

  // QUASE CASOU: alguma variação tem SKU quase igual a um do cadastro (só
  // pontuação/espaço diferente). Isso NÃO é produto novo — é o mesmo produto
  // com o SKU digitado de outro jeito. Criar o espelho aqui DUPLICAVA a peça
  // no catálogo da loja e mandava o estoque para a cópia, enquanto a peça de
  // verdade seguia zerada: exatamente o "não está puxando o estoque" relatado
  // em 31/08/2026 — e sem uma linha na tela explicando. Vira pendência com o
  // SKU parecido do lado (mesma ideia da RN-020: AVISA, nunca junta sozinho).
  // montado uma vez por SINCRONIZAÇÃO quando ela passa os pools (o caminho
  // caro); no webhook, que trata um produto só, sai na hora
  const idxParecidos = pools?.idxParecidos ?? indiceDeSkusParecidos(skuVariants);

  if (!temCandidato) {
    // só aqui interessa (e é aqui que a conta corre): produto sem candidato
    const quaseCasou = variants.some((v) => skuParecidoNoCadastro(v.sku, idxParecidos));
    // produto genuinamente novo: só espelha se tiver SKU; senão fica pendente
    if (temAlgumSku && !quaseCasou) {
      const criado = await criarProdutoEspelhado(companyId, p);
      if (report) report.criadas++;
      return criado;
    }
    const pendencias = variants.map((v) => {
      const { color, size } = corETamanho(p, v);
      return {
        produtoNs: nsName,
        cor: color,
        tamanho: size,
        ...pistaDoSku(v.sku, idxParecidos),
      };
    });
    if (report) report.pendencias.push(...pendencias);
    // webhook e baixa de estoque não têm relatório em curso: sem isto, o
    // produto barrado não era criado E não aparecia em lugar nenhum
    else await registrarPendenciasAvulsas(companyId, pendencias);
    return null;
  }

  const linkedByNsVar = new Map(linkedVariants.map((v) => [v.nuvemshopId, v]));

  // Produto local que este produto da Nuvemshop representa — já identificado
  // por vínculo (nuvemshopId) ou por SKU de alguma variação. Serve pra
  // ADICIONAR variações novas (cor/tamanho novo, com SKU) no produto certo,
  // SOZINHO — assim a lojista fica independente: cria a variação na Nuvemshop
  // e ela aparece aqui, sem virar pendência. Seguro porque o produto já está
  // 100% identificado (nunca cria PRODUTO por conta própria, só variação).
  // SKU repetido no produto de lá não identifica produto nenhum (RN-072): a
  // cópia de um produto feita lá, com o SKU do original em toda a grade,
  // arrastaria a grade inteira do original para si pela cor × tamanho
  const repetidosLa = skusRepetidos(variants);
  const targetProductId =
    um2um?.id ??
    linkedVariants[0]?.productId ??
    variants
      .map((v) => (v.sku && !repetidosLa.has(norm(v.sku)) ? skuMap.get(norm(v.sku)) : undefined))
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
  // TRAVA DA COR (incidente Toque Leve, 30/07/2026), lida uma vez: num
  // catálogo produto-por-cor ("Baby Look — Branco"), variação de OUTRA cor
  // não entra no produto (ver o laço, abaixo)
  const nomeAlvo = targetProductId
    ? allProducts.find((x) => x.id === targetProductId)?.name ?? ""
    : "";
  const corDoProdutoAlvo = corDoNome(nomeAlvo);
  const corForaDoProduto = (cor: string) => !!corDoProdutoAlvo && !mesmaCor(cor, corDoProdutoAlvo);
  // RN-072: cada variação de lá com a sua peça daqui, decidido ANTES do laço
  // e sem repetir peça — SKU repetido lá não casa por SKU (resolve pela cor ×
  // tamanho), e o vínculo da foto do começo não puxa de volta a peça que
  // outro par já levou
  const { alvos: alvosDaRodada, ocupadas, skuRepetidoLa } = escolherAlvos({
    nsProductId: nsId,
    variacoesDeLa: variants.map((v) => {
      const { color, size } = corETamanho(p, v);
      return {
        id: String(v.id),
        sku: v.sku,
        corTam: corForaDoProduto(color) ? null : `${norm(color)}|${norm(size)}`,
      };
    }),
    vinculadas: linkedByNsVar,
    porSku: skuMap,
    porCorTam: targetByCorTam,
  });
  const repetidoLa = (sku: string | null | undefined) => skuRepetidoLa.has(norm(sku));
  const idsDaRodada = new Set(variants.map((v) => String(v.id)));
  // carimbo de lá que está em mais de uma peça daqui (o mapa acima guarda só
  // uma delas): religar limpa as outras
  const vezesDoCarimbo = new Map<string, number>();
  for (const x of linkedVariants) {
    if (x.nuvemshopId) vezesDoCarimbo.set(x.nuvemshopId, (vezesDoCarimbo.get(x.nuvemshopId) ?? 0) + 1);
  }
  const carimbosEmDobro = new Set([...vezesDoCarimbo].filter(([, n]) => n > 1).map(([k]) => k));
  // pendências do laço: com relatório em curso vão nele; no webhook e na
  // baixa da venda paga (sem relatório) vão para o relatório guardado — sem
  // isso, a variação barrada não aparecia em lugar nenhum
  const pendenciasDoLaco: SyncPendencia[] = [];
  // RN-053: peças cuja baixa ainda não foi confirmada lá — o número de lá não
  // pode passar por cima delas (ver o comentário na gravação, abaixo)
  const pendentesDeEnvio =
    pools?.estoquePendente ??
    (await envioPendentePorVariacao(companyId, [
      ...linkedVariants.map((x) => x.id),
      ...skuVariants.map((x) => x.id),
      ...targetVariants.map((x) => x.id),
    ]));
  // RN-057: produtos cujo VAREJO mudou aqui e ainda não foi confirmado lá —
  // o número de lá é o velho, e escrevê-lo por cima desfaria o reajuste
  const precosPendentes =
    pools?.precosPendentes ??
    (await precoPendentePorProduto(companyId, [
      ...linkedVariants.map((x) => x.productId),
      ...skuVariants.map((x) => x.productId),
      ...targetVariants.map((x) => x.productId),
    ]));
  // SKUs que JÁ existem dentro do produto certo, pela forma "só letras e
  // números" — é o que impede a variação duplicada (achado da revisão
  // 31/08/2026): o mesmo SKU escrito de outro jeito, com a cor/tamanho
  // digitada diferente ("Rosa Chá" × "Rosa Cha"), criava uma variação nova
  // e o estoque ia para ela, deixando a de verdade zerada.
  const idxDoProduto = indiceDeSkusParecidos(targetVariants);

  for (const v of variants) {
    const vId = String(v.id);
    const { color, size } = corETamanho(p, v);
    const stock = estoqueNs(v);
    const preco = num(v.price);

    // só casa por vínculo anterior OU por SKU (nunca por nome/cor) — quem
    // decidiu foi o `escolherAlvos` (RN-072)
    let alvo = alvosDaRodada.get(vId) ?? null;

    const pendencia = (
      pista: Pick<SyncPendencia, "sku" | "skuParecido" | "repetido">,
      produtoNs = nsName
    ) =>
      pendenciasDoLaco.push({
        produtoNs,
        cor: color,
        tamanho: size,
        ...pista,
        // repetido LÁ: a pista do cadastro daqui ("SKU igual, repetido
        // aqui") seria falsa — o SKU daqui pode ser único
        ...(repetidoLa(v.sku) ? { skuParecido: null, repetido: false, repetidoLa: true } : {}),
      });

    // SKU REPETIDO lá que a cor × tamanho não resolveu (RN-072): não cria
    // variação com SKU ambíguo (qual dos tamanhos viraria a peça dependeria
    // da ordem da API) e não tenta outro caminho — o conserto é lá
    if (!alvo && repetidoLa(v.sku)) {
      pendencia(pistaDoSku(v.sku, idxParecidos));
      continue;
    }

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
      if (corForaDoProduto(color)) {
        pendencia(
          { sku: v.sku ?? null },
          `${nsName} (cor “${color}” não pertence a “${nomeAlvo}”)`
        );
        continue;
      }
      const existente = targetByCorTam.get(`${norm(color)}|${norm(size)}`);
      if (
        existente &&
        (ocupadas.has(existente.id) || espelhaOutroProduto(existente, nsId, idsDaRodada))
      ) {
        // a cor × tamanho daqui já é o par de OUTRA variação de lá — nesta
        // rodada ou de outro produto de lá (RN-072): casar de novo faria as
        // duas escreverem na mesma peça, uma em cada sincronização. Vira
        // pendência.
        pendencia(pistaDoSku(v.sku, idxParecidos));
        continue;
      } else if (existente) {
        alvo = existente;
        ocupadas.add(existente.id);
      } else if (skuParecidoNoCadastro(v.sku, idxDoProduto)) {
        // o SKU já vive neste produto, escrito de outro jeito: criar aqui
        // duplicaria a variação e mandaria o estoque para a cópia
        pendencia(pistaDoSku(v.sku, idxDoProduto));
        continue;
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
        // o índice aprende a variação recém-criada: duas variações do MESMO
        // lote com SKU quase igual ("A-1" e "A 1") duplicariam sem isto
        const chaveNova = soLetrasENumeros(v.sku);
        if (chaveNova && !idxDoProduto.has(chaveNova)) idxDoProduto.set(chaveNova, v.sku);
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
        ocupadas.add(nova.id);
        if (report) report.casadas++;
        continue;
      }
    }

    if (!alvo) {
      pendencia(pistaDoSku(v.sku, idxParecidos));
      continue;
    }

    const antes = alvo.stock;
    // RN-053: peça com BAIXA AINDA NÃO CONFIRMADA lá não recebe o número de
    // lá por cima. Aqui o mais novo é o NOSSO — a venda aconteceu aqui e o
    // aviso não chegou —, e puxar o número antigo devolveria as peças
    // vendidas ao catálogo: a loja voltaria a vender o que não tem, que é
    // exatamente o estrago que esta regra existe para evitar. E era a saída
    // que o próprio aviso da tela recomendava (achado da revisão).
    // o pool da rodada é o atalho barato; quando o número de lá DIFERE do
    // nosso, reconfere na hora — uma venda entrou aqui no meio da etapa
    // (que pode durar 25s) e a fila já tem a peça, mas o pool não sabe:
    // gravar o número de lá desfaria a venda dos dois lados (achado da
    // revisão)
    const esperandoEnvio =
      pendentesDeEnvio.has(alvo.id) ||
      (alvo.stock !== stock && (await envioPendentePorVariacao(companyId, [alvo.id])).has(alvo.id));
    // RELIGAR grava os DOIS carimbos: o objeto em memória é a foto do começo
    // da rodada, e a limpeza abaixo pode ter zerado no banco o produto de lá
    // desta mesma peça — sem ele, o envio de estoque da venda (RN-053) pula
    // a peça calado (achado da revisão)
    const religa = alvo.nuvemshopId !== vId;
    const dadosDaVariacao = {
      ...(religa ? { nuvemshopId: vId, nuvemshopProductId: nsId } : {}),
      ...(!religa && alvo.nuvemshopProductId !== nsId ? { nuvemshopProductId: nsId } : {}),
      ...(esperandoEnvio || alvo.stock === stock ? {} : { stock }),
      // SKU repetido lá não é copiado para cá: espalharia o SKU ambíguo pelo
      // cadastro, e a trava daqui tiraria do casamento até a peça certa (RN-072)
      ...(v.sku && !alvo.sku && !repetidoLa(v.sku) ? { sku: v.sku } : {}),
    };
    // só vai ao banco quando ALGO mudou: numa página de 25 modelos já
    // sincronizados isso eram ~100 idas ao banco para gravar o mesmo número
    // (a sync inteira precisa caber nos 60s da Vercel, com o banco em outra
    // região a 100 ms por consulta — achado ao investigar a sync da Entre
    // Linhas que "parava no meio", 15/09/2026)
    // RELIGOU (RN-072): a peça daqui que segurava este vínculo antes perde o
    // carimbo — senão duas peças daqui ficavam ligadas à mesma de lá, e a
    // venda da antiga ia avisar a Nuvemshop nesta (RN-053)
    // (também quando o carimbo já estava em DUAS peças daqui — resíduo de
    // estado torto antigo)
    if (religa || carimbosEmDobro.has(vId)) {
      await db.productVariant.updateMany({
        where: { product: { companyId }, nuvemshopId: vId, id: { not: alvo.id } },
        data: { nuvemshopId: null, nuvemshopProductId: null },
      });
      // o pool da sincronização é compartilhado entre os produtos da rodada:
      // ele acompanha o banco, senão o produto seguinte decidia com o
      // carimbo velho
      for (const x of skuVariants) {
        if (x.id === alvo.id) Object.assign(x, { nuvemshopId: vId, nuvemshopProductId: nsId });
        else if (x.nuvemshopId === vId) Object.assign(x, { nuvemshopId: null, nuvemshopProductId: null });
      }
    }
    if (Object.keys(dadosDaVariacao).length > 0) {
      await db.productVariant.update({ where: { id: alvo.id }, data: dadosDaVariacao });
    }
    // registra o movimento — auditável e reversível (nunca sobrescreve sem
    // rastro). Estoque "infinito" fica de fora: o repor 9996 → 9999 de cada
    // sync viraria ruído sem significado no histórico.
    if (!esperandoEnvio && antes !== stock && v.stock != null) {
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
    // preço de varejo acompanha a loja online (o de atacado fica intacto) —
    // salvo quando o número NOVO é o daqui e ainda está a caminho (RN-057)
    // mesma régua de frescor do estoque: preço diferente reconfere a fila
    if (
      preco > 0 &&
      alvo.product.retailPrice !== preco &&
      !precosPendentes.has(alvo.product.id) &&
      !(await precoPendentePorProduto(companyId, [alvo.product.id])).has(alvo.product.id)
    ) {
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
  if (report) report.pendencias.push(...pendenciasDoLaco);
  else await registrarPendenciasAvulsas(companyId, pendenciasDoLaco);

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
  // SKU repetido em mais de uma variação lá não é copiado (RN-072): a peça
  // nasce ligada pelo vínculo e ganha o SKU quando ele for corrigido lá
  const repetidosLa = skusRepetidos(variants);
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
        sku: repetidosLa.has(norm(v.sku)) ? null : v.sku ?? null,
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
  const poolSku = await buscarPoolSku(companyId);
  const pools: PoolsDeSync = {
    skuVariants: poolSku,
    allProducts: await buscarPoolProdutos(companyId),
    idxParecidos: indiceDeSkusParecidos(poolSku),
    precosPendentes: await produtosComPrecoPendente(companyId),
    estoquePendente: await variacoesComEnvioPendente(companyId),
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
      lastSyncEtapa: null,
      lastSyncReport: JSON.stringify({
        at: new Date().toISOString(),
        casadas: report.casadas,
        criadas: report.criadas,
        // a LISTA cabe 100 (o relatório vai para uma coluna de texto), mas o
        // TOTAL é dito inteiro: mostrar "100 pendência(s)" quando são 240
        // escondia o problema justo de quem mais precisa vê-lo
        totalPendencias: report.pendencias.length,
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
/**
 * Quanto tempo uma etapa pode gastar PROCESSANDO produtos. A função da
 * Vercel vive 60s; o que não couber volta para a tela como "parcial", e ela
 * pede a MESMA página de novo pulando o que já foi feito. Antes, uma página
 * lenta (banco em outra região, Nuvemshop devagar) morria nos 60s sem
 * resposta nenhuma — a tela só dizia "interrompida no meio" e a lojista
 * recomeçava da página 1 para morrer no mesmo lugar (Entre Linhas,
 * 15/09/2026).
 */
export const MS_ORCAMENTO_DA_ETAPA = 25_000;

export async function syncPaginaDeProdutos(
  companyId: string,
  page: number,
  desde = 0,
  orcamentoMs = MS_ORCAMENTO_DA_ETAPA,
  /** id (Nuvemshop) do último produto feito na etapa anterior: se a página
   *  mudou de ordem entre as duas chamadas, a retomada é por ele, não pela
   *  posição */
  apos: string | null = null
) {
  const inicio = Date.now();
  // rastro de progresso na ENTRADA, antes de qualquer trabalho: se a função
  // morrer carregando os pools ou esperando a Nuvemshop, o cartão aponta a
  // etapa CERTA (carimbar depois apontava a anterior, já feita)
  const rastro = (pagina: number, desdeN: number) =>
    db.nuvemshopConnection.updateMany({
      where: { companyId },
      data: { lastSyncEtapa: JSON.stringify({ pagina, desde: desdeN, at: new Date().toISOString() }) },
    });
  await rastro(page, desde);
  const conn = await loadConn(companyId);
  if (!conn) return { ok: false as const, produtos: 0, fim: true, status: -1 };
  const report: SyncReport = { casadas: 0, criadas: 0, pendencias: [] };
  const poolSku = await buscarPoolSku(companyId);
  const pools: PoolsDeSync = {
    skuVariants: poolSku,
    allProducts: await buscarPoolProdutos(companyId),
    idxParecidos: indiceDeSkusParecidos(poolSku),
    precosPendentes: await produtosComPrecoPendente(companyId),
    estoquePendente: await variacoesComEnvioPendente(companyId),
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
  // retomada: pela POSIÇÃO, mas se o último produto feito não está mais
  // nela (a lojista criou/apagou produto entre as duas chamadas e a página
  // andou), acha o id e segue dali — pular um produto em silêncio é pior
  // que refazer um
  let comecarEm = Math.min(desde, lista.length);
  if (apos) {
    const i = lista.findIndex((p) => String(p.id) === apos);
    if (i >= 0) comecarEm = i + 1;
  }
  let feitos = 0;
  let parcial = false;
  let ultimoId: string | null = null;
  for (const p of lista.slice(comecarEm)) {
    // SEMPRE faz pelo menos um produto por etapa: devolver "zero feitos"
    // deixaria a tela pedindo a mesma etapa para sempre
    if (feitos > 0 && Date.now() - inicio > orcamentoMs) {
      parcial = true;
      break;
    }
    const criado = await upsertProduct(companyId, p, report, pools);
    feitos++;
    ultimoId = String(p.id);
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
  const fim = !parcial && (lista.length < POR_ETAPA || page >= 100);
  const proximaPagina = parcial ? page : page + 1;
  const proximoDesde = parcial ? comecarEm + feitos : 0;

  // soma o parcial desta etapa no relatório guardado (etapa 1 recomeça)
  const conexao = await db.nuvemshopConnection.findUnique({
    where: { companyId },
    select: { lastSyncReport: true },
  });
  let anterior = {
    casadas: 0,
    criadas: 0,
    totalPendencias: 0,
    pendencias: [] as SyncPendencia[],
  };
  if ((page > 1 || comecarEm > 0) && conexao?.lastSyncReport) {
    try {
      const j = JSON.parse(conexao.lastSyncReport);
      anterior = {
        casadas: j.casadas ?? 0,
        criadas: j.criadas ?? 0,
        // relatório de antes desta versão não tem o total: vale o tamanho da
        // lista (que era o número mostrado na época)
        totalPendencias: j.totalPendencias ?? (Array.isArray(j.pendencias) ? j.pendencias.length : 0),
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
    totalPendencias: anterior.totalPendencias + report.pendencias.length,
    pendencias: [...anterior.pendencias, ...report.pendencias].slice(0, 100),
  };
  await db.nuvemshopConnection.update({
    where: { companyId },
    data: {
      lastSyncReport: JSON.stringify(somado),
      ...(fim ? { lastProductSync: new Date(), lastSyncEtapa: null } : {}),
    },
  });
  // etapa não-final: o rastro passa a apontar para a PRÓXIMA posição
  if (!fim) await rastro(proximaPagina, proximoDesde);

  return {
    ok: true as const,
    produtos: feitos,
    fim,
    parcial,
    // parcial: a MESMA página, pulando o que já foi feito
    proximaPagina,
    desde: proximoDesde,
    apos: parcial ? ultimoId : null,
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
  // A LEITURA TERMINOU INTEIRA? Página que falha no meio (429/5xx/timeout) ou
  // catálogo maior que o teto de páginas devolvem lista PARCIAL — e peça que
  // não foi lida parece "apagada lá". Quem só COMPARA pode conviver com isso;
  // quem CONSERTA (soltar vínculo) não pode: apagaria vínculo bom (achado da
  // revisão de 31/08/2026).
  let completa = true;
  for (let page = 1; page <= 50; page++) {
    const res = await api<NsProduct[]>(conn, "GET", `/products?per_page=50&page=${page}`);
    if (!res.ok && page === 1) {
      return { ok: false as const, status: res.status, variacoes: [], produtos: 0, completa: false };
    }
    if (!res.ok) {
      // PÁGINA QUE FALHOU É LEITURA PARCIAL, PONTO — inclusive o 404. Tentar
      // adivinhar "isso aqui foi só o fim da lista" foi testado e recusado na
      // revisão de 31/08/2026: `completa` é o que AUTORIZA soltar vínculo, e
      // um 404 passageiro faria a página não lida virar "peça apagada lá" e o
      // botão apagar vínculo BOM. O custo de errar para o lado seguro é um
      // aviso âmbar a mais; o do outro lado é estoque quebrado.
      completa = false;
      break;
    }
    if (!res.data?.length) break;
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
    // encostou no teto de páginas com a última cheia: tem mais catálogo lá
    if (page === 50) completa = false;
  }
  return { ok: true as const, status: 200, variacoes, produtos, completa };
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

  // no after(): mesma régua da porta do Financeiro logo abaixo — chamada
  // solta era congelada com a resposta do webhook e o aviso se perdia
  avisarVendaPagaSemQuebrar(companyId, {
    id: order.id,
    number: order.number,
    total: order.total,
    customerName: nome,
  });

  // PORTA ÚNICA DO FINANCEIRO (RN-033): a venda da loja online vira
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
  await db.$transaction(async (tx) => {
    await travarPedido(tx, order.id);
    await tx.order.update({ where: { id: order.id }, data: { status: "CANCELADO" } });
    // saiu da fila de separação (RN-060): o rascunho em andamento é descartado,
    // como na tela do pedido — a cliente cancelou na loja online no meio do bipe
    if (saiuDaFila(order.status, "CANCELADO")) await descartarSeparacaoAtiva(tx, companyId, order.id);
  });
  // o cancelamento da loja online também passa pela porta (RN-033): o
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

/** Nome da peça como a lojista vê, para as mensagens de erro. */
function nomeDaPeca(v: { color: string | null; size: string | null; product: { name: string } }) {
  const grade = [v.color, v.size].filter(Boolean).join(" ");
  return grade ? `${v.product.name} · ${grade}` : v.product.name;
}

/**
 * Manda o estoque de UMA peça e diz se a Nuvemshop CONFIRMOU.
 *
 * Antes o resultado do PUT era jogado fora: recusa do provedor (token
 * vencido, 422, 500, timeout) passava como sucesso e os dois lados iam
 * divergindo calados. Ver RN-053.
 */
async function enviarEstoqueDaPeca(
  conn: Conn,
  nsProductId: string,
  nsVariantId: string,
  stock: number
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const r = await api(conn, "PUT", `/products/${nsProductId}/variants/${nsVariantId}`, { stock });
  if (r.ok) return { ok: true };
  // status 0 é o `api()` engolindo a exceção do fetch: rede fora ou o timeout
  // de 15s. Dizer isso em português é o que a lojista vai ler no painel.
  const motivo =
    r.status === 0
      ? "A Nuvemshop não respondeu (rede fora ou demora demais)"
      : `A Nuvemshop recusou o envio (código ${r.status})`;
  return { ok: false, motivo };
}

/**
 * Baixa de estoque feita AQUI (pedido do catálogo pago) é devolvida pra
 * Nuvemshop, mantendo a dona do estoque em dia. Só variações vinculadas.
 *
 * RN-053: a peça entra na fila ANTES da tentativa e só sai quando a Nuvemshop
 * CONFIRMA. Envio recusado — ou função congelada pela Vercel no meio — deixa a
 * linha lá, e a repesca de carona no tráfego tenta de novo.
 */
export async function pushStockToNuvemshop(companyId: string, variantIds: string[]) {
  if (variantIds.length === 0) return;
  const conn = await loadConn(companyId);
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds }, nuvemshopId: { not: null }, product: { companyId } },
    include: { product: true },
  });
  const limite = Date.now() + MS_ORCAMENTO_REPESCA_ESTOQUE;
  for (const v of variants) {
    // modo produto-por-cor guarda o id do produto NS na própria variação
    const nsProductId = v.nuvemshopProductId ?? v.product.nuvemshopId;
    if (!nsProductId) continue;
    // espelho de estoque "infinito" (stock null na Nuvemshop): NÃO devolve —
    // empurrar 9996 para lá transformaria o "vende sempre" da loja num
    // número finito. Infinito nunca esgota; não há o que espelhar.
    if (v.stock >= ZONA_INFINITO) continue;

    // a fila nasce antes da tentativa: se a função morrer aqui, a peça fica
    // marcada e a repesca cuida — era exatamente esse o envio que sumia
    await marcarEnvioPendente(companyId, v.id);

    // loja desconectada não tem para onde mandar: a peça FICA na fila, e o
    // dia em que a lojista reconectar a repesca acerta o número
    if (!conn) continue;

    // pedido com muitas peças e Nuvemshop lenta estouraria os 60s da função e
    // mataria o `after()` inteiro — junto com a repesca de mídia (RN-028) e o
    // alerta de mínimo (RN-051), que rodam na mesma carona. O que não couber
    // já está NA FILA: a repesca manda, de propósito.
    if (Date.now() + 15_000 > limite) break;

    // o estoque é RELIDO aqui: a lista foi carregada antes do laço e cada PUT
    // pode levar 15s — no meio disso outra venda da mesma peça muda o número,
    // e mandar o velho é a divergência de volta
    const agora = await db.productVariant.findUnique({
      where: { id: v.id },
      select: { stock: true },
    });
    if (!agora || agora.stock >= ZONA_INFINITO) continue;

    const r = await enviarEstoqueDaPeca(conn, nsProductId, v.nuvemshopId!, agora.stock);
    if (r.ok) {
      await confirmarEnvio(v.id, agora.stock);
      continue;
    }
    const temMaisTentativas = await registrarFalhaDeEnvio(companyId, v.id, r.motivo);
    if (!temMaisTentativas) {
      await desistirDoEnvio(companyId, v.id, nomeDaPeca(v), r.motivo);
    }
  }
}

/**
 * Manda o preço de varejo de UMA variação e diz se a Nuvemshop CONFIRMOU
 * (RN-057). Mesma leitura de erro do estoque: status 0 é rede/timeout.
 */
async function enviarPrecoDaPeca(
  conn: Conn,
  nsProductId: string,
  nsVariantId: string,
  preco: number
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  // a API da Nuvemshop recebe o preço como texto com duas casas
  const r = await api(conn, "PUT", `/products/${nsProductId}/variants/${nsVariantId}`, {
    price: preco.toFixed(2),
  });
  if (r.ok) return { ok: true };
  const motivo =
    r.status === 0
      ? "A Nuvemshop não respondeu (rede fora ou demora demais)"
      : `A Nuvemshop recusou o envio (código ${r.status})`;
  return { ok: false, motivo };
}

/**
 * Manda o varejo de UM produto para todas as variações vinculadas dele.
 * Sucesso só quando TODAS confirmaram: pela metade, a peça fica na fila e a
 * repesca manda de novo (o PUT é idempotente — repetir a que já foi não
 * muda nada lá).
 */
async function enviarPrecoDoProduto(
  conn: Conn,
  produto: {
    id: string;
    name: string;
    retailPrice: number;
    nuvemshopId: string | null;
    variants: { nuvemshopId: string | null; nuvemshopProductId: string | null }[];
  },
  limite: number
): Promise<{ ok: true; preco: number } | { ok: false; motivo: string } | { ok: "sem-vinculo" } | { ok: "sem-tempo" }> {
  const vinculadas = produto.variants.filter((v) => v.nuvemshopId && (v.nuvemshopProductId ?? produto.nuvemshopId));
  if (vinculadas.length === 0) return { ok: "sem-vinculo" };
  for (const v of vinculadas) {
    // só começa um envio que ainda cabe no que sobrou do relógio
    if (Date.now() + 15_000 > limite) return { ok: "sem-tempo" };
    const r = await enviarPrecoDaPeca(
      conn,
      (v.nuvemshopProductId ?? produto.nuvemshopId)!,
      v.nuvemshopId!,
      produto.retailPrice
    );
    if (!r.ok) return r;
  }
  return { ok: true, preco: produto.retailPrice };
}

const selecaoDoProdutoParaPreco = {
  id: true,
  name: true,
  retailPrice: true,
  nuvemshopId: true,
  variants: { select: { nuvemshopId: true, nuvemshopProductId: true } },
} as const;

/**
 * Preço de varejo mudado AQUI (ficha da peça ou reajuste em lote) vai para a
 * Nuvemshop (RN-057). Os produtos JÁ estão na fila — quem gravou o preço os
 * marcou na mesma transação; aqui é a primeira tentativa, e o que não couber
 * no orçamento a repesca manda.
 */
export async function pushPriceToNuvemshop(companyId: string, productIds: string[]) {
  if (productIds.length === 0) return;
  const conn = await loadConn(companyId);
  if (!conn) return; // desconectada: os produtos ficam na fila até reconectar
  const limite = Date.now() + MS_ORCAMENTO_REPESCA_ESTOQUE;
  for (const id of productIds) {
    // o reajuste em lote manda dezenas de peças de uma vez: aqui só se
    // começa o que cabe no relógio, e o resto já está na fila — a repesca
    // pega carona também na tela Produtos, que é onde a lojista olha o ⏳
    if (Date.now() + 15_000 > limite) break;
    // relido na hora: o preço pode ter mudado de novo desde a chamada
    const produto = await db.product.findFirst({
      where: { id, companyId },
      select: selecaoDoProdutoParaPreco,
    });
    if (!produto) continue;
    await tentarEnvioDePreco(companyId, conn, produto, limite);
  }
}

async function tentarEnvioDePreco(
  companyId: string,
  conn: Conn,
  produto: { id: string; name: string; retailPrice: number; nuvemshopId: string | null; variants: { nuvemshopId: string | null; nuvemshopProductId: string | null }[] },
  limite: number
) {
  // zero NUNCA vai para a loja online (a peça ficaria de graça lá): as portas
  // recusam antes, e esta é a segunda tranca — desiste dizendo o motivo
  if (!(produto.retailPrice > 0)) {
    await desistirDoEnvioDePreco(companyId, produto.id, produto.name, "Varejo zerado não é mandado para a loja online");
    return;
  }
  const r = await enviarPrecoDoProduto(conn, produto, limite);
  if (r.ok === "sem-tempo") return;
  if (r.ok === "sem-vinculo") {
    // perdeu o vínculo: não há o que espelhar, sai da fila
    await confirmarEnvioDePreco(produto.id);
    return;
  }
  if (r.ok === true) {
    await confirmarEnvioDePreco(produto.id, r.preco);
    return;
  }
  const temMaisTentativas = await registrarFalhaDePreco(companyId, produto.id, r.motivo);
  if (!temMaisTentativas) {
    await desistirDoEnvioDePreco(companyId, produto.id, produto.name, r.motivo);
  }
}

/** O jeito CERTO de chamar o espelho de PREÇO de dentro de uma rota (RN-057). */
export function espelharPrecoSemQuebrar(companyId: string, productIds: string[]): void {
  if (productIds.length === 0) return;
  const trabalho = () =>
    pushPriceToNuvemshop(companyId, productIds).catch((e) =>
      logServerError({
        source: "server",
        path: "/nuvemshop/preco",
        message: "Falha ao espelhar o preço na Nuvemshop",
        detail: `loja ${companyId}: ${e instanceof Error ? e.message : String(e)}`,
      }).catch(() => null)
    );
  try {
    after(trabalho);
  } catch {
    void trabalho();
  }
}

/** Repesca dos PREÇOS que não chegaram (RN-057), dentro da rodada do estoque. */
async function repescarPrecos(companyId: string, conn: Conn, limite: number) {
  const pendentes = await produtosParaRepescarPreco(companyId);
  for (const p of pendentes) {
    if (Date.now() + 15_000 > limite) break;
    // o filtro por loja é SEGUNDA tranca (RN-013)
    const produto = await db.product.findFirst({
      where: { id: p.productId, companyId },
      select: selecaoDoProdutoParaPreco,
    });
    if (!produto) {
      await confirmarEnvioDePreco(p.productId);
      continue;
    }
    await tentarEnvioDePreco(companyId, conn, produto, limite);
  }
}

/**
 * O jeito CERTO de chamar o espelho de estoque de dentro de uma rota (RN-053).
 *
 * Chamada solta (`pushStockToNuvemshop(...).catch(() => {})`) parece
 * inofensiva e não é: a Vercel CONGELA a função assim que a resposta sai, e o
 * trabalho que ficou pendurado simplesmente não acontece — sem erro, sem
 * registro, sem nada. É a mesma lição da RN-033, e foi metade do sumiço do
 * estoque da peça. Dentro do `after()` o Next segura a função até o trabalho
 * terminar.
 *
 * O `try/catch` cobre quem chama fora de uma requisição (script, teste): ali
 * o `after()` recusa, e aí a chamada solta é o que existe.
 */
export function espelharEstoqueSemQuebrar(companyId: string, variantIds: string[]): void {
  const trabalho = () =>
    pushStockToNuvemshop(companyId, variantIds).catch((e) =>
      // falha inesperada (o banco fora, por exemplo) vira caso no painel de
      // Saúde, como na repesca — console sozinho ninguém lê
      logServerError({
        source: "server",
        path: "/nuvemshop/estoque",
        message: "Falha ao espelhar o estoque na Nuvemshop",
        detail: `loja ${companyId}: ${e instanceof Error ? e.message : String(e)}`,
      }).catch(() => null)
    );
  try {
    after(trabalho);
  } catch {
    void trabalho();
  }
}

/**
 * REPESCA dos envios de estoque que não chegaram (RN-053).
 *
 * Pega carona no tráfego com trava por loja — nunca um 3º cron (ADR-002) — e
 * tem orçamento de tempo: cada PUT pode levar 15s, e a rodada roda depois da
 * resposta, ainda dentro da vida da função.
 */
export async function varrerEnviosDeEstoqueSeDevido(companyId: string): Promise<void> {
  let travaTomadaEm: Date | null = null;
  try {
    // olha ANTES de tomar a trava: loja que nunca conectou a Nuvemshop não
    // paga um UPDATE em Company por minuto vindo da rota mais movimentada —
    // a consulta cai no índice (companyId, proximaEm) e volta vazia (achado
    // da revisão de performance). O freio em memória continua segurando a
    // batida de 3s do sync.
    const [temEstoque, temPreco] = await Promise.all([
      pecasParaRepescar(companyId),
      produtosParaRepescarPreco(companyId),
    ]);
    if (temEstoque.length === 0 && temPreco.length === 0) return;

    travaTomadaEm = await tomarTravaDaRepesca(companyId);
    if (!travaTomadaEm) return;

    const conn = await loadConn(companyId);
    if (!conn) return; // desconectada: as peças ficam esperando a reconexão

    const limite = Date.now() + MS_ORCAMENTO_REPESCA_ESTOQUE;
    // RN-057: os preços entram na MESMA rodada, com a mesma trava e o mesmo
    // relógio — estoque primeiro (vender peça que não tem é o estrago maior)
    const pendentes = await pecasParaRepescar(companyId);
    if (pendentes.length === 0) {
      await repescarPrecos(companyId, conn, limite);
      return;
    }

    const variants = await db.productVariant.findMany({
      // o filtro por loja é SEGUNDA tranca (RN-013): os ids já vêm da fila
      // desta loja, mas isolamento não pode depender de um lugar só — uma
      // linha de fila com companyId errado empurraria estoque na conexão de
      // outra loja (achado da revisão)
      where: { id: { in: pendentes.map((p) => p.variantId) }, product: { companyId } },
      include: { product: true },
    });
    const porId = new Map(variants.map((v) => [v.id, v]));

    for (const p of pendentes) {
      // só começa um envio que ainda cabe no que sobrou do relógio
      if (Date.now() + 15_000 > limite) break;
      const v = porId.get(p.variantId);
      const nsProductId = v ? (v.nuvemshopProductId ?? v.product.nuvemshopId) : null;
      // peça que perdeu o vínculo (ou o estoque virou infinito lá) não tem o
      // que espelhar: sai da fila em vez de tentar para sempre
      if (!v || !v.nuvemshopId || !nsProductId || v.stock >= ZONA_INFINITO) {
        await confirmarEnvio(p.variantId);
        continue;
      }
      const r = await enviarEstoqueDaPeca(conn, nsProductId, v.nuvemshopId, v.stock);
      if (r.ok) {
        await confirmarEnvio(v.id, v.stock);
        continue;
      }
      const temMaisTentativas = await registrarFalhaDeEnvio(companyId, v.id, r.motivo);
      if (!temMaisTentativas) {
        await desistirDoEnvio(companyId, v.id, nomeDaPeca(v), r.motivo);
      }
    }
    await repescarPrecos(companyId, conn, limite);
  } catch (e) {
    // devolve a trava para a próxima batida tentar de novo (senão a loja
    // ficava um minuto calada) e registra no painel de Saúde
    if (travaTomadaEm) await devolverTravaDaRepesca(companyId, travaTomadaEm);
    await logServerError({
      source: "server",
      path: "/nuvemshop/estoque/repesca",
      message: "Falha na repesca do estoque da Nuvemshop",
      detail: e instanceof Error ? e.message : String(e),
    }).catch(() => null);
  }
}
