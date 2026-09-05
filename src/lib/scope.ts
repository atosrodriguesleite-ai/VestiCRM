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
 * Quem enxerga TODAS as conversas da loja (gerência/suporte, ou vendedora com
 * a chavinha `chatVisaoTotal`). É a MESMA régua do `conversationScope`, numa
 * função nomeada — irmã do `veTodosPedidos` — porque a busca por palavra
 * precisa escrevê-la em SQL (`buscarMensagens` lê a maior tabela da loja e
 * não pode filtrar DEPOIS do teto de resultados). Duas cópias da régua de
 * visibilidade que discordem é a pior divergência possível por aqui: se a
 * exceção mudar um dia, muda aqui e vale nos dois lugares.
 */
export function veTodaAConversa(user: SessionUser): boolean {
  return canSeeAll(user) || user.chatVisaoTotal;
}

/**
 * Filtro para conversas (Central de Atendimento).
 * Vendedor enxerga os atendimentos DELE + toda a FILA (conversas sem
 * responsável) — é o modelo de fila compartilhada: um número da loja para
 * todos os vendedores, quem estiver livre "assume" da fila.
 *
 * EXCEÇÃO POR PESSOA — `chatVisaoTotal` (pedido da Toque Leve, 17/08/2026):
 * a vendedora marcada vê TODAS as conversas da loja, como gerente. Vale SÓ
 * aqui, no chat: carteira, pedidos, comissão e relatórios seguem o escopo
 * normal de vendedora. O admin liga/desliga na tela Equipe e vale na hora
 * (a sessão relê o usuário do banco a cada requisição).
 */
export function conversationScope(user: SessionUser) {
  return veTodaAConversa(user)
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
 *
 * EXCEÇÃO POR PESSOA — `pedidosVisaoTotal` (pedido da Toque Leve,
 * 17/08/2026, irmã da chavinha do chat): a vendedora marcada vê os pedidos
 * da LOJA inteira — e, desde 18/08/2026 (decisão do dono), também EDITA
 * qualquer um deles, porque toda mexida do PATCH fica registrada no
 * histórico do pedido com quem fez. A comissão continua pelo `sellerId`
 * (ver ou editar um pedido não o torna dela), transferir a venda da colega
 * ou assumir pedido sem dona continua proibido (`podeTransferirVenda`), e a
 * exportação de pedidos segue o escopo normal.
 * O admin liga/desliga na tela Equipe e vale na hora.
 */
/**
 * Quem ENXERGA todos os pedidos da loja (gerência/suporte, ou vendedora com
 * a chavinha `pedidosVisaoTotal`). É a MESMA regra do orderScope — num lugar
 * só, para tela e escopo nunca discordarem: se a exceção da RN-007 mudar um
 * dia, muda aqui e vale em todo canto.
 */
export function veTodosPedidos(user: SessionUser) {
  return canSeeAll(user) || Boolean(user.pedidosVisaoTotal);
}

export function orderScope(user: SessionUser) {
  return veTodosPedidos(user)
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

/**
 * QUEM CUIDA DAS INTEGRAÇÕES (conectar, desconectar, sincronizar).
 *
 * Inclui o SUPORTE de propósito: quando a Nuvemshop desanda ou o estoque
 * desencontra, quem resolve é o suporte — e antes ele precisava acordar um
 * admin para clicar em "sincronizar". Isso é trabalho operacional, não
 * comercial: ninguém aqui mexe em preço, comissão ou pedido mínimo.
 *
 * Vendedora fica de fora: integração quebrada afeta a loja inteira.
 */
export function podeOperarIntegracoes(user: SessionUser) {
  return isAdmin(user) || user.role === "MANAGER" || user.role === "SUPPORT";
}

export function isManagerUp(user: SessionUser) {
  return (
    user.role === "ADMIN" ||
    user.role === "SUPERADMIN" ||
    user.role === "MANAGER"
  );
}
