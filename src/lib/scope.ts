import type { SessionUser } from "./auth";

/**
 * Regras de visibilidade (item 10/11 do produto):
 * - SUPERADMIN: todas as empresas (não aplica filtro de companyId aqui;
 *   nas telas normais ele opera dentro da própria empresa).
 * - ADMIN / MANAGER / SUPPORT: tudo dentro da própria empresa.
 * - SELLER: apenas os próprios clientes/negócios/atendimentos.
 *
 * SUPPORT (perfil "Suporte") vê TODOS os pedidos/clientes/conversas, mas é
 * operacional: não cancela pedido, não dá desconto, não mexe no catálogo
 * nem nas telas comerciais (dashboard/funil/automações/campanhas).
 *
 * Toda consulta DEVE partir destes filtros — é o que garante o isolamento
 * multi-tenant: nenhuma loja enxerga dados de outra.
 */

export function canSeeAll(user: SessionUser) {
  return user.role !== "SELLER";
}

/** Filtro base de tenant — obrigatório em todas as consultas. */
export function tenant(user: SessionUser) {
  return { companyId: user.companyId };
}

/** Filtro para entidades com dono (ownerId): vendedor vê só as suas. */
export function ownedScope(user: SessionUser) {
  return canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, ownerId: user.id };
}

/**
 * Filtro para conversas (Central de Atendimento).
 * Vendedor enxerga os atendimentos DELE + toda a FILA (conversas sem
 * responsável) — é o modelo de fila compartilhada: um número da loja para
 * todos os vendedores, quem estiver livre "assume" da fila.
 */
export function conversationScope(user: SessionUser) {
  return canSeeAll(user)
    ? { companyId: user.companyId }
    : {
        companyId: user.companyId,
        OR: [{ assigneeId: user.id }, { assigneeId: null }],
      };
}

/**
 * Filtro da área de Pedidos.
 *
 * VENDEDORA VÊ SÓ O QUE É DELA. O painel de pedidos é a tela de trabalho
 * dela: o pedido que ela montou, o orçamento que ela mandou, a cobrança que
 * ela precisa correr atrás. Misturar os pedidos das colegas ali não ajuda em
 * nada — atrapalha (ela procura o dela no meio de dezenas que não são) e
 * ainda expõe a carteira de uma para a outra.
 *
 * O dono da venda é o `sellerId` — o MESMO campo que manda na comissão. É
 * assim que "quem mandou o link leva a venda" chega até aqui: o pedido que
 * nasceu do link da Juliana aparece no painel da Juliana, e o da Lara no da
 * Lara. Pedido sem vendedora (venda da loja online, por exemplo) é da loja e
 * aparece para gerência.
 *
 * Gerente, admin e suporte continuam vendo a loja inteira.
 */
export function orderScope(user: SessionUser) {
  return canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, sellerId: user.id };
}

/** Filtro para tarefas (assigneeId). */
export function taskScope(user: SessionUser) {
  return canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, assigneeId: user.id };
}

export function isAdmin(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "SUPERADMIN";
}

/** Apenas o Super Admin da plataforma (provisiona/gerencia lojas). */
export function isSuperAdmin(user: SessionUser) {
  return user.role === "SUPERADMIN";
}

/** Perfil Suporte — gestão de pedidos e atendimento, sem poderes comerciais. */
export function isSupport(user: SessionUser) {
  return user.role === "SUPPORT";
}

export function isManagerUp(user: SessionUser) {
  return (
    user.role === "ADMIN" ||
    user.role === "SUPERADMIN" ||
    user.role === "MANAGER"
  );
}
