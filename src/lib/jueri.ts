/**
 * Integração Jueri (ERP de semijoias/consignação) — helpers compartilhados.
 *
 * A Jueri não tem grade de tamanhos: cada produto vira UMA variação aqui
 * (tamanho "Único"), com a cor do campo `cor` (e hexadecimal quando vier).
 * Preços chegam numa lista `tipo_preco` (Varejo/Atacado/...); fotos vêm em
 * `imagem` (capa) e `fotos_adicionais` (lista), sempre como URL.
 */

export const JUERI_BASE =
  process.env.JUERI_API_BASE ?? "https://jueri.com.br/sis/api/v1";

export async function jueriGet(token: string, path: string) {
  const res = await fetch(`${JUERI_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sem JSON */
  }
  return { status: res.status, body };
}

export async function jueriPut(token: string, path: string, data: unknown) {
  const res = await fetch(`${JUERI_BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(data),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* sem JSON */
  }
  return { status: res.status, body };
}

export type JueriProduto = {
  id: number | string;
  descricao?: string;
  descricao_completa?: string | null;
  referencia?: string | null;
  codigo_barras?: string | number | null;
  cor?: string | null;
  cor_hexadecimal?: string | null;
  quantidade?: number | null;
  custo_compra_bruto?: number | null;
  custo_total?: number | null;
  fk_categoria_id?: number | null;
  fk_status_id?: number | null;
  imagem?: string | null;
  fotos_adicionais?: unknown;
  tipo_preco?: { id?: number; nome?: string; pivot?: { preco?: number } }[];
};

/** Varejo e Atacado a partir da lista tipo_preco (nomes flexíveis). */
export function extrairPrecos(p: JueriProduto): { varejo: number; atacado: number } {
  let varejo = 0;
  let atacado = 0;
  for (const t of p.tipo_preco ?? []) {
    const nome = (t.nome ?? "").toLowerCase();
    const preco = Number(t.pivot?.preco ?? 0) || 0;
    if (nome.includes("varejo")) varejo = preco;
    else if (nome.includes("atacado")) atacado = preco;
  }
  // sem "Varejo" nomeado: usa o primeiro preço como varejo
  if (!varejo && (p.tipo_preco?.length ?? 0) > 0) {
    varejo = Number(p.tipo_preco![0].pivot?.preco ?? 0) || 0;
  }
  return { varejo, atacado };
}

/** Fotos (capa + adicionais) como URLs http, sem a foto-padrão do sistema. */
export function extrairFotos(p: JueriProduto): string[] {
  const urls: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//.test(v) && !v.includes("foto-padrao")) {
      if (!urls.includes(v)) urls.push(v);
    } else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      add(o.imagem ?? o.url ?? o.foto ?? o.src);
    }
  };
  add(p.imagem);
  if (Array.isArray(p.fotos_adicionais)) for (const f of p.fotos_adicionais) add(f);
  return urls.slice(0, 8);
}

/** SKU estável: referência > código de barras > id da Jueri. */
export function montarSku(p: JueriProduto): string {
  const ref = (p.referencia ?? "").toString().trim();
  if (ref) return ref;
  const cb = (p.codigo_barras ?? "").toString().trim();
  if (cb) return cb;
  return `JUERI-${p.id}`;
}

/**
 * Sincronia de volta (Opção A): a venda no AtacadoPro baixa o estoque na
 * Jueri (e o cancelamento devolve). `changes` traz o delta EXATO por
 * variação (−qtde vendida / +qtde devolvida) — nunca sobrescreve o número,
 * pra não atropelar vendas feitas direto na Jueri.
 *
 * Escrita conservadora: lê o produto, reenvia descrição e preços SEM alterar
 * (a API exige esses campos no PUT) e só troca a `quantidade`. Se a Jueri
 * recusar ou não responder, ignora em silêncio — nunca corrompe o dado dela.
 * Roda em 2º plano; erros não travam a venda no AtacadoPro.
 */
export async function pushStockToJueri(
  companyId: string,
  changes: { variantId: string; delta: number }[]
) {
  if (changes.length === 0) return;
  // import tardio: mantém este módulo utilizável sem puxar o Prisma à toa
  const { db } = await import("./db");
  const { decryptSecret } = await import("./crypto");
  const conn = await db.jueriConnection.findUnique({ where: { companyId } });
  if (!conn) return;
  // token guardado criptografado (conexão antiga em texto puro passa direto)
  const token = decryptSecret(conn.token);

  const deltaByVariant = new Map(changes.map((c) => [c.variantId, c.delta]));
  const variants = await db.productVariant.findMany({
    where: {
      id: { in: changes.map((c) => c.variantId) },
      product: { companyId, jueriId: { not: null } },
    },
    include: { product: { select: { jueriId: true } } },
  });

  for (const v of variants) {
    const delta = deltaByVariant.get(v.id) ?? 0;
    if (delta === 0 || !v.product.jueriId) continue;
    const rota = `/${conn.clienteSistema}/produto/${v.product.jueriId}`;
    const atual = await jueriGet(token, rota);
    const prod = atual.body as JueriProduto | null;
    if (atual.status !== 200 || !prod) continue; // não conseguiu ler: não arrisca

    const novo = Math.max(0, Math.round((Number(prod.quantidade) || 0) + delta));
    await jueriPut(token, rota, {
      descricao: prod.descricao,
      tipo_preco: prod.tipo_preco,
      quantidade: novo,
    });
  }
}
