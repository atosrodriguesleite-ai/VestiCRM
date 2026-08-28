/**
 * Regra PURA do desempate de recibos do WhatsApp (roda sem banco, testável).
 *
 * Quando mais de um recibo esperou a mesma bolha (o "órfão" da corrida do
 * eco pelo celular — incidente 28/08/2026), vale o mais FORTE: LIDA vence
 * ENTREGUE (visto implica entregue) e ENTREGUE vence FALHOU (um "falhou"
 * seguido de "entregue" é o provedor se corrigindo — a mensagem CHEGOU).
 */
export type ReciboStatus = "ENTREGUE" | "LIDA" | "FALHOU";

export function reciboMaisForte(lista: ReciboStatus[]): ReciboStatus | null {
  if (lista.includes("LIDA")) return "LIDA";
  if (lista.includes("ENTREGUE")) return "ENTREGUE";
  if (lista.includes("FALHOU")) return "FALHOU";
  return null;
}

/**
 * A força de cada status da mensagem — recibo NUNCA faz a bolha regredir.
 *
 * Sem esta régua, a reaplicação do órfão podia sobrescrever um status mais
 * forte aplicado ao vivo no meio-tempo (LIDA voltava a ENTREGUE, ENTREGUE
 * virava "Falhou" com erro falso — achado da revisão de 28/08/2026).
 * FALHOU fica ACIMA de ENVIADA de propósito: o recibo de erro em mensagem
 * "enviada" é informação nova (não chegou); mas ENTREGUE/LIDA vencem FALHOU
 * (a mensagem chegou — a falha anterior era alarme falso).
 */
const FORCA: Record<string, number> = {
  ENVIANDO: 0,
  ENVIADA: 1,
  FALHOU: 2,
  ENTREGUE: 3,
  LIDA: 4,
};

export function reciboAvanca(atual: string, novo: ReciboStatus): boolean {
  return (FORCA[novo] ?? 0) > (FORCA[atual] ?? 0);
}
