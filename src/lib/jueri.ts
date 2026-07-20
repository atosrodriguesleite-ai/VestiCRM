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
