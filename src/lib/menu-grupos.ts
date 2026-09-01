/**
 * A QUAL GRUPO DO MENU CADA TELA PERTENCE — regra pura.
 *
 * Mora fora do `app-shell` (que é `"use client"` e desenha) porque é decisão,
 * não desenho: assim o teste pergunta "onde cai a tela X para a loja Y?" em
 * vez de procurar texto dentro do componente.
 */

export const GRUPO_FINANCEIRO = "Financeiro";

export type ContextoDoMenu = {
  /** Super Admin na própria casa: o menu inteiro é remapeado */
  modoPlataforma: boolean;
  /** a loja tem o módulo Financeiro completo (RN-029) */
  financeEnabled: boolean;
};

/**
 * Com o módulo ligado, as nove telas do dinheiro saem de "Análise" e ganham
 * grupo próprio. SEM a chave nada muda: o "Financeiro" simples continua em
 * Análise, exatamente onde sempre morou.
 */
export function grupoDoMenu(
  href: string,
  grupoDeclarado: string,
  ctx: ContextoDoMenu,
  grupoNoModoPlataforma?: string
): string {
  if (ctx.modoPlataforma) return grupoNoModoPlataforma ?? grupoDeclarado;
  if (ctx.financeEnabled && href.startsWith("/financeiro")) return GRUPO_FINANCEIRO;
  return grupoDeclarado;
}

/**
 * Dentro do grupo FINANCEIRO o painel não se chama "Financeiro" — seria o
 * nome do grupo repetido na primeira linha. Chama "Visão geral", que é o que
 * ele mostra.
 */
export function rotuloDoMenu(
  href: string,
  rotulo: string,
  ctx: ContextoDoMenu
): string {
  return !ctx.modoPlataforma && ctx.financeEnabled && href === "/financeiro"
    ? "Visão geral"
    : rotulo;
}
