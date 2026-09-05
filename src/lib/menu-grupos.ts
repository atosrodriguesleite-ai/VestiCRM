/**
 * O QUE O MENU MOSTRA, E EM QUAL GRUPO — regra pura.
 *
 * Mora fora do `app-shell` (que é `"use client"` e desenha) porque é decisão,
 * não desenho: assim o teste pergunta "a loja Y vê a tela X? em qual grupo?"
 * em vez de procurar texto dentro do componente.
 */

export const GRUPO_FINANCEIRO = "Financeiro";

/** As chaves de um item do menu que decidem se ele aparece. */
export type ItemDoMenu = {
  href: string;
  /** o perfil Suporte é operacional: telas comerciais ficam fora */
  supportHidden?: boolean;
  superOnly?: boolean;
  /** módulos pagos à parte: sem a chave da loja, o item NEM aparece */
  productionOnly?: boolean;
  cutPlanOnly?: boolean;
  shippingOnly?: boolean;
  financeOnly?: boolean;
  marketingOnly?: boolean;
  mediaLibraryOnly?: boolean;
  aiOnly?: boolean;
  /** gerente, admin e super admin */
  managerOnly?: boolean;
  /** quem cuida de integração e conexão — inclui Suporte */
  operacional?: boolean;
};

/** O que o shell sabe de quem está logado e da loja dele. */
export type QuemVeOMenu = {
  role: string;
  productionEnabled?: boolean;
  cutPlanEnabled?: boolean;
  shippingEnabled?: boolean;
  financeEnabled?: boolean;
  marketingEnabled?: boolean;
  mediaLibraryEnabled?: boolean;
  aiSalesEnabled?: boolean;
};

const GERENCIA = ["ADMIN", "MANAGER", "SUPERADMIN"];

/**
 * Este item aparece para esta pessoa, nesta loja?
 *
 * A CHAVE DO MÓDULO vem antes do papel: loja sem o módulo não vê o item, seja
 * quem for. Vale para o Financeiro inteiro (RN-029, pedido do dono em
 * 05/09/2026): antes o painel "Financeiro" ficava no menu de TODA loja — como
 * tela simples de pedidos a receber — e a loja sem o módulo via uma aba de
 * financeiro pela metade. Agora só quem tem o módulo tem a aba.
 */
export function itemVisivel(i: ItemDoMenu, user: QuemVeOMenu): boolean {
  if (user.role === "SUPPORT" && i.supportHidden) return false;
  if (i.superOnly) return user.role === "SUPERADMIN";
  if (i.productionOnly && !user.productionEnabled) return false;
  if (i.cutPlanOnly && !user.cutPlanEnabled) return false;
  if (i.shippingOnly && !user.shippingEnabled) return false;
  if (i.financeOnly && !user.financeEnabled) return false;
  if (i.marketingOnly && !user.marketingEnabled) return false;
  if (i.mediaLibraryOnly && !user.mediaLibraryEnabled) return false;
  if (i.aiOnly && !user.aiSalesEnabled) return false;
  if (i.managerOnly) return GERENCIA.includes(user.role);
  if (i.operacional) return [...GERENCIA, "SUPPORT"].includes(user.role);
  return true;
}

export type ContextoDoMenu = {
  /** Super Admin na própria casa: o menu inteiro é remapeado */
  modoPlataforma: boolean;
};

/**
 * Em qual grupo o item cai. Fora do modo plataforma, é o grupo que o item
 * declara — as nove telas do dinheiro declaram "Financeiro", e o grupo só
 * aparece para a loja que tem o módulo porque os itens dele só aparecem para
 * ela (`itemVisivel`); grupo sem item não desenha.
 */
export function grupoDoMenu(
  grupoDeclarado: string,
  ctx: ContextoDoMenu,
  grupoNoModoPlataforma?: string
): string {
  if (ctx.modoPlataforma) return grupoNoModoPlataforma ?? grupoDeclarado;
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
  return !ctx.modoPlataforma && href === "/financeiro" ? "Visão geral" : rotulo;
}
