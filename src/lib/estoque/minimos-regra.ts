/**
 * MÍNIMO POR PEÇA, POR CATEGORIA E DA LOJA (RN-051) — a parte PURA.
 *
 * Mora separada do acesso ao banco porque a tela (navegador) lê daqui
 * (ADR-012: tela não arrasta código de servidor).
 *
 * Pedido do dono (09/09/2026): "preciso ter como colocar um alerta para cada
 * peça ou categoria dizendo qual é o mínimo que posso ter daquele produto".
 *
 * Três degraus, e vale o MAIS ESPECÍFICO:
 *   1. a peça (`Product.minStock`) — vale para CADA cor × tamanho do modelo;
 *   2. a categoria (`EstoqueMinimoCategoria`) — "toda calça, pelo menos 2";
 *   3. a loja (`Company.lowStockThreshold`) — o número que já existia e que
 *      o Dashboard e a tela Produtos sempre usaram.
 *
 * A régua do alerta é a MESMA de sempre ("avisa quando a variação CHEGA a X
 * peças": disponível ≤ mínimo) — mudar para "abaixo de" faria o cartão do
 * Dashboard e o Inventário discordarem sobre a mesma peça.
 */

export type OrigemDoMinimo = "PECA" | "CATEGORIA" | "LOJA";

export type MinimoEfetivo = { valor: number; origem: OrigemDoMinimo };

export const ROTULO_DA_ORIGEM: Record<OrigemDoMinimo, string> = {
  PECA: "da peça",
  CATEGORIA: "da categoria",
  LOJA: "da loja",
};

/** Teto do mínimo — acima disso é erro de digitação, não estoque de moda. */
export const TETO_DO_MINIMO = 100_000;

/** Qual mínimo vale para esta variação? (pura) */
export function minimoEfetivo(m: {
  peca: number | null | undefined;
  categoria: number | null | undefined;
  loja: number;
}): MinimoEfetivo {
  if (m.peca != null) return { valor: m.peca, origem: "PECA" };
  if (m.categoria != null) return { valor: m.categoria, origem: "CATEGORIA" };
  return { valor: m.loja, origem: "LOJA" };
}

/** Chegou ao mínimo? (a régua de sempre: disponível ≤ mínimo) */
export function noMinimo(disponivel: number, minimo: number): boolean {
  return disponivel <= minimo;
}

/** Mínimo válido para gravar? inteiro, zero ou mais, com teto. */
export function minimoValido(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= TETO_DO_MINIMO;
}

