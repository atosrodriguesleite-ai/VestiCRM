import { orderStatusLabel, PAID_ORDER_STATUSES } from "../orders";
import type { OrderStatus } from "@prisma/client";

/**
 * A VARIAÇÃO QUE NÃO SE REMOVE DIZ QUAL PEDIDO A SEGURA (RN-050).
 *
 * Relato do dono (25/09/2026, print de uma lojista): *"ela está com vários
 * pedidos, então não está conseguindo localizar o pedido que reservou a
 * peça"*. A recusa mandava "cancele ou conclua O pedido" sem dizer qual —
 * beco sem saída numa loja com dezenas de pedidos abertos. Agora ela diz o
 * número, a cliente, a situação e quantas peças cada pedido segura.
 *
 * Pedido fora do recorte de quem está editando (RN-007: a vendedora vê só os
 * dela) entra só na CONTA, como "pedido de colega" — sem número nem cliente.
 * Regra pura; a consulta mora em `pedidosQueSeguram` (inventario.ts).
 *
 * **Pedido PAGO não trava** (segundo relato do dono, no mesmo dia: os dois
 * pedidos que seguravam a peça estavam em SEPARAÇÃO — *"separação já
 * vendeu, então não pode segurar"*). Venda é venda (RN-001): a peça já é
 * da cliente, e o pedido não precisa do cadastro para continuar existindo —
 * o item guarda nome, cor e tamanho congelados e perde só o vínculo (e com
 * ele o código de barras: na separação ela aparece para conferir na mão,
 * RN-060). Quem trava é o pedido que AINDA NÃO É venda — orçamento e
 * aguardando pagamento —, porque ali a reserva é a promessa da peça, e
 * apagar a variação apagaria a prova do que foi separado para a cliente.
 */

/**
 * Este pedido (que segura a peça) impede remover a variação? Só se ainda
 * não virou venda. Derivado da lista de venda (RN-001) — lista à mão é
 * onde um status novo se perde.
 */
export function travaARemocao(status: OrderStatus): boolean {
  return !PAID_ORDER_STATUSES.includes(status);
}

export type PedidoQueSegura = {
  numero: number;
  status: OrderStatus;
  cliente: string;
  pecas: number;
  /** quem está editando enxerga este pedido (RN-007)? */
  visivel: boolean;
};

/** Até quantos pedidos a frase nomeia (o resto vira "e mais N"). */
export const TETO_DE_PEDIDOS_NA_FRASE = 5;

export function fraseDaPecaPresa(
  rotuloDaPeca: string,
  reservado: number,
  pedidos: PedidoQueSegura[]
): string {
  const inicio = `${rotuloDaPeca} tem ${reservado} peça(s) reservada(s)`;
  // defensivo: quem chama só pergunta com a lista cheia; sem ela, frase sem número
  if (pedidos.length === 0) {
    return `${inicio} em pedido ainda não pago. Tire a peça do pedido ou cancele-o antes de remover.`;
  }
  const vistos = pedidos.filter((p) => p.visivel).sort((a, b) => a.numero - b.numero);
  const deColega = pedidos.length - vistos.length;
  const nomeados = vistos.slice(0, TETO_DE_PEDIDOS_NA_FRASE).map(
    (p) =>
      `#${p.numero} (${p.cliente}, ${orderStatusLabel[p.status].toLowerCase()}, ${p.pecas} ${
        p.pecas === 1 ? "peça" : "peças"
      })`
  );
  const partes = [...nomeados];
  const sobra = vistos.length - nomeados.length;
  if (sobra > 0) partes.push(`mais ${sobra} ${sobra === 1 ? "pedido" : "pedidos"}`);
  if (deColega > 0) {
    partes.push(`${deColega} ${deColega === 1 ? "pedido de colega" : "pedidos de colegas"}`);
  }
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
  const um = pedidos.length === 1;
  return (
    `${inicio} ${um ? "no pedido" : "nos pedidos"} ${lista}. ` +
    `Para remover, tire a peça ${um ? "desse pedido" : "desses pedidos"} ou cancele ` +
    `devolvendo as peças. (Pedido já pago não impede: ali a peça já foi vendida.)`
  );
}

/** Um pedido em aberto que tinha a variação removida (pedido pago, ou sem reserva). */
export type PedidoAfetado = { numero: number; visivel: boolean };

/**
 * O que a pessoa que removeu LÊ na hora (achado da revisão): a remoção que
 * passa por cima de pedido pago não pode ser calada — quem está na bancada
 * da Separação vai achar a peça sem código e ninguém saberia por quê. Diz
 * quais pedidos (o de colega só conta, RN-007) e o que muda para eles.
 * `null` quando nenhum pedido em aberto tinha a peça.
 */
export function avisoDaRemocao(pedidos: PedidoAfetado[]): string | null {
  if (pedidos.length === 0) return null;
  const vistos = pedidos.filter((p) => p.visivel).map((p) => p.numero).sort((a, b) => a - b);
  const deColega = pedidos.length - vistos.length;
  const partes = vistos.slice(0, TETO_DE_PEDIDOS_NA_FRASE).map((n) => `#${n}`);
  const sobra = vistos.length - partes.length;
  if (sobra > 0) partes.push(`mais ${sobra}`);
  if (deColega > 0) partes.push(`${deColega} ${deColega === 1 ? "de colega" : "de colegas"}`);
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes.at(-1)}`;
  const um = pedidos.length === 1;
  return (
    `Removida. ${um ? "O pedido" : "Os pedidos"} ${lista} ${um ? "continua" : "continuam"} com a peça, ` +
    `só sem código de barras — na Separação, conferir na mão. ` +
    `Se ${um ? "ele for cancelado" : "algum for cancelado"}, essa peça não volta sozinha ao estoque ` +
    `(a variação não existe mais). O histórico de cada pedido registra a remoção.`
  );
}
