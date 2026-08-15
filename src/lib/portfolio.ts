/**
 * PORTFÓLIO DE PRODUTOS E SERVIÇOS — regras puras (sem banco).
 *
 * É o manual dos serviços que a plataforma vende junto com o CRM. Aqui ficam
 * as contas que o painel mostra: quanto custa entregar (soma das posições
 * alocadas) e quanto sobra em cima do preço cobrado.
 *
 * Tudo em função pura para ser testável e para a tela nunca fazer conta por
 * conta própria — a fonte da verdade do dinheiro é este arquivo.
 */

export const PORTFOLIO_STATUS = ["DISPONIVEL", "RASCUNHO", "DESCONTINUADO"] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUS)[number];

export const statusLabel: Record<string, string> = {
  DISPONIVEL: "Disponível",
  RASCUNHO: "Rascunho",
  DESCONTINUADO: "Descontinuado",
};

/** Cor do selo de status — paleta do AtacadoPro, nada de marca de terceiro. */
export const statusTone: Record<string, "green" | "amber" | "slate"> = {
  DISPONIVEL: "green",
  RASCUNHO: "amber",
  DESCONTINUADO: "slate",
};

export const MATERIAL_KINDS = ["VENDAS", "OPERACIONAL", "TREINAMENTO"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const materialKindLabel: Record<string, string> = {
  VENDAS: "Materiais de vendas",
  OPERACIONAL: "Materiais operacionais",
  TREINAMENTO: "Materiais de treinamento",
};

/** Papel da linha na DRE — define cor e peso visual, não faz conta sozinho. */
export const DRE_SIGNS = ["ENTRADA", "SAIDA", "RESULTADO", "NEUTRO"] as const;
export type DreSign = (typeof DRE_SIGNS)[number];

export const dreSignLabel: Record<string, string> = {
  ENTRADA: "(+) Entrada",
  SAIDA: "(−) Saída",
  RESULTADO: "(=) Resultado",
  NEUTRO: "Neutro",
};

type PositionLike = { hours?: number | null; cost?: number | null };
type VariantLike = { name: string; baseValue?: number | null };

/**
 * Soma das posições alocadas: total de horas e custo de entrega.
 * Valores ausentes contam como zero — linha pela metade não quebra o total.
 */
export function totalPositions(positions: PositionLike[]): {
  hours: number;
  cost: number;
} {
  return positions.reduce<{ hours: number; cost: number }>(
    (acc, p) => ({
      hours: acc.hours + (Number(p.hours) || 0),
      cost: acc.cost + (Number(p.cost) || 0),
    }),
    { hours: 0, cost: 0 }
  );
}

/**
 * Resumo financeiro do produto: o que entra, o que custa e o que sobra.
 *
 * `price` é o preço praticado (o da variação, quando houver — ver
 * `precoVigente`). Sem preço definido não há margem a calcular: devolve null
 * em vez de fingir que a margem é negativa.
 */
export function resumoFinanceiro(
  price: number | null | undefined,
  positions: PositionLike[]
): { custo: number; horas: number; margem: number | null; margemPct: number | null } {
  const { hours, cost } = totalPositions(positions);
  const preco = typeof price === "number" && Number.isFinite(price) ? price : null;
  if (preco === null) {
    return { custo: cost, horas: hours, margem: null, margemPct: null };
  }
  const margem = preco - cost;
  // preço zero não gera divisão por zero: sem base, não há percentual
  const margemPct = preco > 0 ? (margem / preco) * 100 : null;
  return { custo: cost, horas: hours, margem, margemPct };
}

/**
 * Preço que vale para o produto.
 *
 * Quando o produto tem variações, quem manda no preço é a variação escolhida
 * (é assim que "Basic" e "E-commerce" custam diferente). Sem variação
 * selecionada, ou variação sem preço próprio, cai no valor base do produto.
 */
export function precoVigente(
  baseValue: number | null | undefined,
  variants: VariantLike[],
  selectedVariant?: string | null
): number | null {
  const base =
    typeof baseValue === "number" && Number.isFinite(baseValue) ? baseValue : null;
  if (!selectedVariant) return base;
  const v = variants.find((x) => x.name === selectedVariant);
  if (!v) return base;
  return typeof v.baseValue === "number" && Number.isFinite(v.baseValue)
    ? v.baseValue
    : base;
}

/** Rótulo do preço para a tela — "A definir" é informação, não erro. */
export function precoLabel(price: number | null): string {
  if (price === null) return "A definir";
  return price.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Categorias já usadas, para o filtro da listagem e para sugerir no cadastro.
 * Sai da própria base: o dono cria as dele conforme cadastra, sem precisar
 * de tela de configuração.
 */
export function categoriasEmUso(
  products: { category?: string | null }[]
): string[] {
  const set = new Set<string>();
  for (const p of products) {
    const c = (p.category ?? "").trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Busca da listagem: casa nome, resumo e categoria, ignorando acento e caixa.
 * O dono digita "midia" e acha "Gestão de Mídia Paga".
 */
export function matchBusca(
  p: { name: string; shortDesc?: string | null; category?: string | null },
  termo: string
): boolean {
  const q = normalizar(termo);
  if (!q) return true;
  const alvo = normalizar(
    [p.name, p.shortDesc ?? "", p.category ?? ""].join(" ")
  );
  return alvo.includes(q);
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
