import type { OrderStatus } from "@prisma/client";
import { orderStatusLabel, PAID_ORDER_STATUSES } from "./orders";

/**
 * SELO DA CLIENTE NA CENTRAL — RN-063 (pedido do dono, 21/09/2026).
 *
 * "Queria bater o olho no WhatsApp e saber, de forma destacada, quem já fez
 * pedido e quem de fato é cliente (já pagou) — e quem compra de novo."
 *
 * NÃO É ETIQUETA, É SITUAÇÃO CALCULADA DOS PEDIDOS. Etiqueta manual esquece,
 * erra e envelhece (a "Pago" colocada à mão continua lá depois do cancelamento
 * e não sobe para "recompra" sozinha). E gravar um carimbo "quando o pedido
 * vira pago" exigiria lembrar de gravar em cada um dos caminhos por onde um
 * pedido nasce e muda de status (tela, catálogo, colar do WhatsApp,
 * Nuvemshop, Pix do gateway) — "esqueceu um" é a classe de defeito que mais
 * custou aqui (a lição da RN-059). Calculando dos pedidos, o selo muda no
 * mesmo instante por qualquer caminho, inclusive cancelar e apagar, e ninguém
 * consegue colocar nem tirar na mão: se o selo está errado, o pedido está.
 *
 * Três degraus, e o maior vence:
 *   • RECOMPRA — 2 ou mais pedidos PAGOS (RN-001): é a cliente que voltou
 *   • CLIENTE  — 1 pedido pago
 *   • PEDIDO   — nenhum pago, mas tem pedido EM ABERTO (orçamento, aguardando)
 *   • nada     — só conversa (e "nada" é informação: é lead)
 *
 * Pago é a lista da RN-001 (pago, em produção, separação, enviado, entregue);
 * cancelado não conta para nada. "Recompra" conta PEDIDOS pagos, não dias:
 * dois pedidos pagos no mesmo dia são recompra — limite aceito, dito ao dono.
 *
 * Este arquivo é PURO (chega ao navegador pelo filtro da lista); a consulta
 * mora em `selo-da-cliente-data.ts`.
 */
export type SeloDaCliente = "PEDIDO" | "CLIENTE" | "RECOMPRA";

export type ContagemDePedidos = {
  /** pedidos em status pago (RN-001) */
  pagos: number;
  /** pedidos vivos ainda não pagos (orçamento, aguardando pagamento) */
  abertos: number;
};

/** o que a lista da Central recebe por cliente */
export type SeloInfo = ContagemDePedidos & { selo: SeloDaCliente | null };

/**
 * "Em aberto" é DERIVADO: todo status que não é pago nem cancelado. Lista à
 * mão é onde um status novo se perde (régua da RN-060). A lista completa vem
 * das chaves de `orderStatusLabel` (tipada `Record<OrderStatus, …>`: status
 * novo sem rótulo nem compila) — e não do enum em tempo de execução, porque
 * este arquivo chega ao NAVEGADOR e `@prisma/client` não pode ir junto.
 */
export const STATUS_EM_ABERTO: OrderStatus[] = (
  Object.keys(orderStatusLabel) as OrderStatus[]
).filter((s) => s !== "CANCELADO" && !PAID_ORDER_STATUSES.includes(s));

export function seloDaCliente(c: ContagemDePedidos): SeloDaCliente | null {
  if (c.pagos >= 2) return "RECOMPRA";
  if (c.pagos === 1) return "CLIENTE";
  if (c.abertos > 0) return "PEDIDO";
  return null;
}

/**
 * Soma as linhas do `groupBy` (cliente × status × quantidade) em pagos e
 * abertos por cliente. Cancelado que escapar da consulta cai fora aqui
 * também — duas trancas para a mesma régua.
 */
export function contarPedidos(
  linhas: { customerId: string; status: OrderStatus; n: number }[]
): Map<string, ContagemDePedidos> {
  const por = new Map<string, ContagemDePedidos>();
  for (const l of linhas) {
    const c = por.get(l.customerId) ?? { pagos: 0, abertos: 0 };
    if (PAID_ORDER_STATUSES.includes(l.status)) c.pagos += l.n;
    else if (STATUS_EM_ABERTO.includes(l.status)) c.abertos += l.n;
    por.set(l.customerId, c);
  }
  return por;
}

export function infoDoSelo(c: ContagemDePedidos | undefined): SeloInfo {
  const cont = c ?? { pagos: 0, abertos: 0 };
  return { ...cont, selo: seloDaCliente(cont) };
}

/** os chips de filtro da lista */
export type FiltroDeSelo = "CLIENTES" | "RECOMPRA" | "PEDIDO";

/**
 * "Clientes" junta quem comprou uma vez E quem recomprou (recompra é
 * cliente); "Recompra" só as que voltaram; "Com pedido" só quem ainda não
 * pagou nenhum.
 */
export function casaFiltroDeSelo(
  selo: SeloDaCliente | null | undefined,
  filtro: FiltroDeSelo
): boolean {
  if (!selo) return false;
  if (filtro === "CLIENTES") return selo === "CLIENTE" || selo === "RECOMPRA";
  if (filtro === "RECOMPRA") return selo === "RECOMPRA";
  return selo === "PEDIDO";
}

/** texto do selo, com o número de compras quando ele diz algo */
export function rotuloDoSelo(info: SeloInfo): string {
  if (info.selo === "RECOMPRA") return `Cliente · ${info.pagos} compras`;
  if (info.selo === "CLIENTE") return "Cliente";
  if (info.selo === "PEDIDO")
    return info.abertos === 1 ? "Pedido" : `${info.abertos} pedidos`;
  return "";
}

/** a frase do tooltip — explica de onde o selo vem, para ninguém tentar tirar */
export function explicacaoDoSelo(info: SeloInfo): string {
  if (info.selo === "RECOMPRA")
    return `Recompra: ${info.pagos} pedidos pagos. O selo é calculado dos pedidos — não se coloca nem se tira na mão.`;
  if (info.selo === "CLIENTE")
    return "Já comprou: 1 pedido pago. O selo é calculado dos pedidos — não se coloca nem se tira na mão.";
  if (info.selo === "PEDIDO")
    return `Tem ${info.abertos === 1 ? "1 pedido" : `${info.abertos} pedidos`} em aberto e nenhum pago ainda. Vira "Cliente" quando um pedido for pago.`;
  return "";
}
