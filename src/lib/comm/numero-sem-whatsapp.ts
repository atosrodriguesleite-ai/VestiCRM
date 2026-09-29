import { celularSemONove, formatPhone } from "../format";

/**
 * O WHATSAPP DISSE QUE O NÚMERO NÃO EXISTE (relato do dono, 29/09/2026).
 *
 * Antes de mandar, o servidor de conexão (Evolution) pergunta ao WhatsApp se
 * o número tem conta; quando não tem, recusa com HTTP 400 e uma lista
 * `[{ jid, exists: false, number }]`. A bolha mostrava isso CRU — um JSON
 * cortado no meio —, e duas vendedoras tentaram de novo sem saber que o
 * problema era o número, não o envio. Aqui a recusa vira frase: o número não
 * tem WhatsApp, confira com a cliente — e, quando é celular sem o 9 (o erro
 * mais comum de quem digita o próprio número), a sugestão com o 9.
 */

/** A resposta do servidor diz que o número NÃO tem WhatsApp? (pura) */
export function respostaDizSemWhatsapp(data: unknown): boolean {
  const lista = (data as { response?: { message?: unknown } } | null)?.response?.message;
  return (
    Array.isArray(lista) &&
    lista.some((m) => typeof m === "object" && m !== null && (m as { exists?: unknown }).exists === false)
  );
}

/** A frase que a bolha e a Central de Comunicação mostram. (pura) */
export function fraseNumeroSemWhatsapp(numero: string): string {
  const base = `Este número não tem WhatsApp: ${formatPhone(numero)}. Não adianta reenviar — confira o telefone com a cliente.`;
  const comNove = celularSemONove(numero);
  return comNove
    ? `${base} Celular tem 9 números depois do DDD: talvez tenha faltado o 9 — ${formatPhone(comNove)}.`
    : base;
}
