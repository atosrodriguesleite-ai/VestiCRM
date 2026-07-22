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
 * Filtro da área de Pedidos. Por decisão do lojista, TODOS os perfis
 * (inclusive o vendedor) enxergam os pedidos da loja — a visibilidade de
 * pedidos é liberada; o isolamento entre lojas (companyId) continua.
 * Ações destrutivas (excluir/cancelar) seguem as regras de cada perfil.
 */
export function orderScope(user: SessionUser) {
  return { companyId: user.companyId };
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
