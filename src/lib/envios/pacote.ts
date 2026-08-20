import type { VolumePacote } from "../melhorenvio-tipos";

/**
 * MONTAGEM DO PACOTE PELAS CATEGORIAS (RN-019) — regra pura, sem servidor.
 *
 * A caixa padrão era UMA para a loja inteira: o mesmo tamanho para 5 ou 50
 * peças, o que no atacado erra sempre (ideia do dono, 19/08/2026). Aqui cada
 * categoria tem as medidas de UMA peça dobrada, e o pacote nasce EMPILHANDO:
 *
 *   base   = a maior peça do pedido (maior comprimento × maior largura)
 *   altura = soma das alturas de todas as peças
 *   peso   = soma dos pesos (que já vem do motor de peso existente)
 *
 * Módulo puro de propósito: a tela do simulador e as rotas usam o mesmo
 * cálculo, e o teste guarda a conta sem precisar de banco.
 */

/** Medidas de UMA peça dobrada da categoria, em cm. */
export type MedidaPeca = {
  compCm: number;
  largCm: number;
  altCm: number;
};

/** Uma linha do pedido/simulação: tantas peças de tal categoria. */
export type PilhaDePecas = {
  categoria: string;
  quantidade: number;
};

/**
 * Pilha mais alta que isto vira mais de um volume. 100 cm é o teto dos
 * Correios para um lado da caixa — acima disso a cotação perderia justamente
 * a transportadora mais usada; e uma pilha de 1 metro não é uma caixa real,
 * é a expedição usando duas.
 */
export const ALTURA_MAXIMA_VOLUME_CM = 100;

/** A etiqueta aceita no máximo isto de volumes (mesmo teto das rotas). */
const MAXIMO_VOLUMES = 8;

// Mínimos dos Correios (16 × 11 × 2 cm): pacote calculado menor que isso é
// recusado na transportadora — melhor arredondar aqui do que perder a cotação
const MINIMO_COMP_CM = 16;
const MINIMO_LARG_CM = 11;
const MINIMO_ALT_CM = 2;

/** JSON gravado na conexão → medidas por categoria (registro torto = fora). */
export function lerMedidasPorCategoria(json: string): Record<string, MedidaPeca> {
  if (!json) return {};
  try {
    const bruto = JSON.parse(json) as unknown;
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
    const medidas: Record<string, MedidaPeca> = {};
    for (const [categoria, v] of Object.entries(bruto as Record<string, unknown>)) {
      const { compCm, largCm, altCm } = (v ?? {}) as Record<string, unknown>;
      const nums = [compCm, largCm, altCm].map(Number);
      if (nums.some((n) => !Number.isFinite(n) || n <= 0 || n > 150)) continue;
      medidas[categoria] = { compCm: nums[0], largCm: nums[1], altCm: nums[2] };
    }
    return medidas;
  } catch {
    return {};
  }
}

/**
 * Monta os volumes do pacote a partir das pilhas de peças.
 *
 * Devolve `null` quando o cálculo não é confiável — alguma categoria sem
 * medidas, pilha vazia, ou um pedido tão grande que nem 8 volumes dão conta.
 * Quem chama cai na caixa padrão da loja, o comportamento de sempre: o
 * recurso melhora quem cadastrou, não muda nada para quem não cadastrou.
 */
export function montarPacote(
  pilhas: PilhaDePecas[],
  medidas: Record<string, MedidaPeca>,
  pesoTotalKg: number
): VolumePacote[] | null {
  if (pilhas.length === 0 || !(pesoTotalKg > 0)) return null;

  let compBase = 0;
  let largBase = 0;
  let alturaTotal = 0;
  for (const p of pilhas) {
    const m = medidas[p.categoria];
    if (!m || !Number.isInteger(p.quantidade) || p.quantidade < 1) return null;
    compBase = Math.max(compBase, m.compCm);
    largBase = Math.max(largBase, m.largCm);
    alturaTotal += m.altCm * p.quantidade;
  }

  const volumes = Math.ceil(alturaTotal / ALTURA_MAXIMA_VOLUME_CM);
  if (volumes > MAXIMO_VOLUMES) return null;

  const comp = Math.max(MINIMO_COMP_CM, Math.ceil(compBase));
  const larg = Math.max(MINIMO_LARG_CM, Math.ceil(largBase));
  // altura dividida por igual entre os volumes (a expedição divide a pilha)
  const altura = Math.max(MINIMO_ALT_CM, Math.ceil(alturaTotal / volumes));
  const pesoPorVolume = Math.round((pesoTotalKg / volumes) * 1000) / 1000;

  return Array.from({ length: volumes }, () => ({
    pesoKg: Math.max(0.05, pesoPorVolume),
    alturaCm: altura,
    larguraCm: larg,
    comprimentoCm: comp,
  }));
}

/**
 * Itens de um pedido → pilhas por categoria. Devolve `null` se algum item
 * ficou sem produto (apagado depois da venda): sem categoria não há medida,
 * e chutar uma seria justamente o que este motor veio evitar.
 */
export function pilhasDosItens(
  items: { quantity: number; product: { category: string } | null }[]
): PilhaDePecas[] | null {
  const porCategoria = new Map<string, number>();
  for (const i of items) {
    if (!i.product) return null;
    porCategoria.set(
      i.product.category,
      (porCategoria.get(i.product.category) ?? 0) + i.quantity
    );
  }
  if (porCategoria.size === 0) return null;
  return [...porCategoria.entries()].map(([categoria, quantidade]) => ({
    categoria,
    quantidade,
  }));
}

/** JSON de pesos por categoria → mapa (parse UMA vez por requisição). */
export function lerPesosPorCategoria(json: string): Record<string, number> {
  try {
    const bruto = json ? (JSON.parse(json) as unknown) : {};
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {};
    return bruto as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Peso de UMA peça da categoria, em gramas: padrão da categoria → padrão da
 * loja (mesma escada do motor de peso do pedido, sem a etapa do produto —
 * no simulador ainda não existe pedido, só categorias).
 */
export function pesoDaCategoriaG(
  categoria: string,
  pesos: Record<string, number>,
  defaultWeightGrams: number
): number {
  const daCategoria = Number(pesos[categoria]);
  return daCategoria > 0 ? daCategoria : defaultWeightGrams;
}
