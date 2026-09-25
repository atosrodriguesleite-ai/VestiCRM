import { orderStatusLabel } from "../orders";
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
 */

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
  // corrida rara (o pedido mudou entre as duas leituras): a frase de antes
  if (pedidos.length === 0) {
    return `${inicio} em pedido. Cancele ou conclua o pedido antes de remover.`;
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
    `devolvendo as peças — ou, se já foi despachado, marque como enviado.`
  );
}
