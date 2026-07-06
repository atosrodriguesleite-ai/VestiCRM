import type { SessionUser } from "./auth";

/**
 * Regras de visibilidade (item 10/11 do produto):
 * - SUPERADMIN: todas as empresas (não aplica filtro de companyId aqui;
 *   nas telas normais ele opera dentro da própria empresa).
 * - ADMIN / MANAGER / SUPPORT: tudo dentro da própria empresa.
 * - SELLER: apenas os próprios clientes/negócios/atendimentos.
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

/** Filtro para conversas (assigneeId). */
export function conversationScope(user: SessionUser) {
  return canSeeAll(user)
    ? { companyId: user.companyId }
    : { companyId: user.companyId, assigneeId: user.id };
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

export function isManagerUp(user: SessionUser) {
  return (
    user.role === "ADMIN" ||
    user.role === "SUPERADMIN" ||
    user.role === "MANAGER"
  );
}
