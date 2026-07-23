import { db } from "./db";
import { norm, type SyncPendencia } from "./nuvemshop";

/**
 * Relatório PRÉ-CONEXÃO: o lojista exporta a planilha de produtos da
 * Nuvemshop (Produtos → Exportar → CSV) e sobe aqui ANTES de conectar.
 * A simulação roda EXATAMENTE a mesma regra de casamento da sincronização
 * real — só casa por SKU da variação; sem SKU nada integra — mas em modo
 * leitura: nada é criado nem alterado no sistema. Assim a prévia nunca
 * engana: o que ela mostra é o que a importação de verdade vai fazer.
 */

export type ProdutoPlanilha = {
  name: string;
  variants: { color: string; size: string; sku: string | null; stock: number }[];
};

export type SimulacaoReport = {
  produtosNs: number;
  variacoesNs: number;
  casariam: number;
  criariam: string[]; // nomes dos produtos que entrariam novos (espelhados)
  pendencias: SyncPendencia[];
};

// ---- Leitura do CSV --------------------------------------------------------

/** Divide o texto em registros respeitando aspas (célula com ; , ou quebra). */
function lerCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, ""); // BOM do Excel
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Detecta o separador olhando o cabeçalho (a Nuvemshop usa ";"). */
function detectarSeparador(text: string): string {
  const header = text.slice(0, text.indexOf("\n") + 1 || text.length);
  const semAspas = header.replace(/"[^"]*"/g, "");
  const pv = (semAspas.match(/;/g) ?? []).length;
  const vg = (semAspas.match(/,/g) ?? []).length;
  return pv >= vg ? ";" : ",";
}

/**
 * Interpreta a planilha exportada da Nuvemshop (uma linha por variação).
 * Aceita também planilhas simples com colunas Nome/Cor/Tamanho/SKU/Estoque.
 */
export function parseNuvemshopCsv(text: string): ProdutoPlanilha[] {
  const rows = lerCsv(text, detectarSeparador(text));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => norm(h));

  const acha = (pred: (h: string) => boolean) => header.findIndex(pred);
  const idxUrl = acha((h) => h.includes("identificador"));
  const idxNome = (() => {
    const exato = acha((h) => h === "nome" || h === "nome do produto" || h === "produto");
    if (exato >= 0) return exato;
    return acha((h) => h.startsWith("nome") && !h.includes("propriedade") && !h.includes("seo"));
  })();
  const idxSku = acha((h) => h === "sku" || h === "sku da variacao");
  const idxEstoque = acha((h) => h === "estoque" || h === "stock" || h === "quantidade");
  const idxCor = acha((h) => h === "cor" || h === "color");
  const idxTam = acha((h) => h === "tamanho" || h === "tam" || h === "size");
  // pares "Nome da propriedade N" / "Valor da propriedade N" do export oficial
  const props: { nome: number; valor: number }[] = [];
  header.forEach((h, i) => {
    const m = h.match(/^nome da propriedade\s*(\d+)/);
    if (!m) return;
    const valor = acha((x) => x === `valor da propriedade ${m[1]}`);
    if (valor >= 0) props.push({ nome: i, valor });
  });
  if (idxNome < 0 && idxUrl < 0) return [];

  const cel = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const porChave = new Map<string, ProdutoPlanilha>();
  const ordem: string[] = [];
  let chaveAnterior = "";
  let nomeAnterior = "";
  const propAnterior = new Map<string, string[]>(); // nomes das propriedades por produto

  for (const r of rows.slice(1)) {
    const url = cel(r, idxUrl);
    const nome = cel(r, idxNome);
    // linhas de variação repetem o identificador e podem vir sem o nome
    const chave = url || norm(nome) || chaveAnterior;
    if (!chave) continue;
    chaveAnterior = chave;
    if (nome) nomeAnterior = nome;

    let prod = porChave.get(chave);
    if (!prod) {
      prod = { name: nome || nomeAnterior || chave, variants: [] };
      porChave.set(chave, prod);
      ordem.push(chave);
    }

    let color = cel(r, idxCor);
    let size = cel(r, idxTam);
    if (props.length) {
      // nome da propriedade pode vir só na 1ª linha do produto: carrega adiante
      const nomesProp = props.map((p, k) => cel(r, p.nome) || propAnterior.get(chave)?.[k] || "");
      propAnterior.set(chave, nomesProp);
      props.forEach((p, k) => {
        const val = cel(r, p.valor);
        if (!val) return;
        const np = norm(nomesProp[k]);
        if (/cor|color/.test(np)) color = color || val;
        else if (/tam|talle|size/.test(np)) size = size || val;
        else if (!np && k === 0) color = color || val;
        else if (!np && k === 1) size = size || val;
      });
    }

    const estoque = parseInt(cel(r, idxEstoque).replace(/\D/g, ""), 10);
    prod.variants.push({
      color: color || "Único",
      size: size || "Único",
      sku: cel(r, idxSku) || null,
      stock: Number.isFinite(estoque) ? estoque : 0,
    });
  }
  return ordem.map((c) => porChave.get(c)!).filter((p) => p.variants.length > 0);
}

// ---- Simulação (mesmas camadas do upsertProduct, em modo leitura) ----------

export async function simularVinculo(
  companyId: string,
  nsProducts: ProdutoPlanilha[]
): Promise<SimulacaoReport> {
  const locais = await db.product.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      variants: { select: { id: true, color: true, size: true, sku: true } },
    },
  });
  const skuMap = new Map<string, { productName: string }>();
  for (const lp of locais) {
    for (const v of lp.variants) {
      if (v.sku) skuMap.set(norm(v.sku), { productName: lp.name });
    }
  }

  const report: SimulacaoReport = {
    produtosNs: nsProducts.length,
    variacoesNs: 0,
    casariam: 0,
    criariam: [],
    pendencias: [],
  };

  for (const p of nsProducts) {
    report.variacoesNs += p.variants.length;

    // REGRA ÚNICA (igual ao import real): só casa por SKU. Sem SKU não integra.
    const temMatchSku = p.variants.some((v) => v.sku && skuMap.has(norm(v.sku)));
    const temAlgumSku = p.variants.some((v) => (v.sku ?? "").trim());

    if (!temMatchSku) {
      // Nenhum SKU casa com o catálogo → produto NOVO (espelhado). Mas só
      // entra se tiver ao menos um SKU; e dentro dele, variação sem SKU não
      // integra — vira pendência (idêntico ao criarProdutoEspelhado real).
      if (temAlgumSku) {
        report.criariam.push(p.name);
        for (const v of p.variants) {
          if (!(v.sku ?? "").trim()) {
            report.pendencias.push({ produtoNs: p.name, cor: v.color, tamanho: v.size, sku: null });
          }
        }
      } else {
        // sem SKU nenhum: nada casa e nada é criado → tudo pendência
        for (const v of p.variants) {
          report.pendencias.push({ produtoNs: p.name, cor: v.color, tamanho: v.size, sku: null });
        }
      }
      continue;
    }

    // Produto será VINCULADO por SKU: cada variação casa só pelo próprio SKU.
    for (const v of p.variants) {
      if (v.sku && skuMap.has(norm(v.sku))) report.casariam++;
      else
        report.pendencias.push({
          produtoNs: p.name,
          cor: v.color,
          tamanho: v.size,
          sku: v.sku,
        });
    }
  }
  report.pendencias = report.pendencias.slice(0, 200);
  return report;
}
