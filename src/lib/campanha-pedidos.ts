import type { Prisma } from "@prisma/client";

/**
 * OS PEDIDOS DE UMA CAMPANHA — e por que isso precisa de dois caminhos.
 *
 * Relato do dono (01/09/2026): o cartão da campanha dizia "1 pedido" e ele
 * não achou o pedido em lugar nenhum. O número existia, mas não levava a
 * nada — e nada na lista de Pedidos dizia de qual campanha o pedido veio.
 *
 * Um pedido é da campanha por DOIS caminhos, e os dois valem:
 *  • o CARIMBO no pedido (`Order.campaignRef`, RN-040) — o jeito direto, mas
 *    só existe em pedido feito depois que o carimbo passou a ser gravado;
 *  • a SESSÃO de navegação (`Order.trackSessionId` apontando para uma sessão
 *    daquela campanha) — é assim que os pedidos ANTIGOS são encontrados.
 *
 * Sem o segundo caminho, o histórico da loja sumiria da tela justamente na
 * primeira vez que ela fosse procurar.
 */
export function whereDaCampanha(
  slug: string,
  sessionIds: string[]
): Prisma.OrderWhereInput {
  return {
    // cancelado não é venda da campanha — mesma régua do contador do cartão,
    // senão o cartão diz 2 e a lista mostra 4
    status: { not: "CANCELADO" },
    OR: [
      { campaignRef: slug },
      // `in: []` seria "sem filtro" numa refatoração futura; id impossível
      // deixa a lista vazia de propósito quando não há sessão nenhuma
      { trackSessionId: { in: sessionIds.length ? sessionIds : ["sem-sessao"] } },
    ],
  };
}

/**
 * O pedido é DESTA campanha? Mesma regra da consulta acima, para contar em
 * memória sem voltar ao banco — número da tela e lista filtrada TÊM que
 * bater, senão a lojista continua sem achar o pedido.
 */
export function ehDaCampanha(
  pedido: { campaignRef: string | null; trackSessionId: string | null },
  slug: string,
  sessionIds: Set<string>
): boolean {
  if (pedido.campaignRef === slug) return true;
  return !!pedido.trackSessionId && sessionIds.has(pedido.trackSessionId);
}
