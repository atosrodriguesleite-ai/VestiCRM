/**
 * A LOJA JÁ CONECTADA PASSA A ESCUTAR O EVENTO NOVO SOZINHA.
 *
 * A lista de eventos que o servidor Evolution manda para o webhook é
 * gravada na INSTÂNCIA, no dia da conexão. Quando o sistema passa a precisar
 * de um evento novo (MESSAGES_EDITED, 17/09/2026: sem ele a mensagem editada
 * pela cliente nunca chegava), toda loja já conectada continua assinada na
 * lista VELHA — e a única auto-cura que existia rodava ao abrir a tela de
 * conexão, que a loja conectada não abre nunca mais.
 *
 * Aqui a régua é um carimbo: `CommSettings.evolutionWebhookEventos` guarda a
 * lista que o servidor CONFIRMOU. Diferente da lista atual do código →
 * reassina e carimba. Roda de carona (no webhook, depois da resposta; no
 * vigia; na tela de conexão) — nunca um cron novo (ADR-002). Uma vez por
 * loja, de verdade: com o carimbo em dia não vai ao servidor.
 *
 * Falha não carimba e não derruba nada: a próxima batida tenta de novo, com
 * freio em memória para não bater no servidor a cada mensagem enquanto ele
 * estiver recusando.
 */

import { db } from "@/lib/db";
import { evolutionEnv, evoSetWebhook, WEBHOOK_EVENTOS_ATUAIS } from "./evolution";

export type AssinaturaDaLoja = {
  companyId: string;
  evolutionInstance: string | null;
  evolutionWebhookToken: string | null;
  evolutionWebhookEventos: string | null;
};

/** A lista carimbada é diferente da que o código precisa hoje? */
export function precisaReassinar(s: AssinaturaDaLoja): boolean {
  if (!s.evolutionInstance || !s.evolutionWebhookToken) return false;
  return s.evolutionWebhookEventos !== WEBHOOK_EVENTOS_ATUAIS;
}

// freio: instância → quando foi a última tentativa que FALHOU
const ultimaFalha = new Map<string, number>();
export const MS_FREIO_APOS_FALHA = 10 * 60 * 1000;

export type ResultadoDaAssinatura = "em-dia" | "reassinada" | "falhou" | "sem-instancia" | "em-freio";

export async function garantirEventosDoWebhook(
  s: AssinaturaDaLoja,
  opts: { sempre?: boolean; agora?: number } = {}
): Promise<ResultadoDaAssinatura> {
  if (!s.evolutionInstance || !s.evolutionWebhookToken) return "sem-instancia";
  if (!evolutionEnv().configured) return "sem-instancia";
  if (!opts.sempre && !precisaReassinar(s)) return "em-dia";
  const agora = opts.agora ?? Date.now();
  const falhouHaPouco = ultimaFalha.get(s.evolutionInstance);
  if (!opts.sempre && falhouHaPouco && agora - falhouHaPouco < MS_FREIO_APOS_FALHA) {
    return "em-freio";
  }
  try {
    const r = await evoSetWebhook(s.evolutionInstance, s.evolutionWebhookToken);
    if (!r.ok) {
      ultimaFalha.set(s.evolutionInstance, agora);
      return "falhou";
    }
    ultimaFalha.delete(s.evolutionInstance);
    // carimba SÓ o que o servidor confirmou — e só se a instância ainda for
    // a mesma (a loja pode ter desconectado no meio)
    await db.commSettings.updateMany({
      where: { companyId: s.companyId, evolutionInstance: s.evolutionInstance },
      data: { evolutionWebhookEventos: WEBHOOK_EVENTOS_ATUAIS },
    });
    return "reassinada";
  } catch {
    ultimaFalha.set(s.evolutionInstance, agora);
    return "falhou";
  }
}

/** Só para teste: esquece o freio. */
export function _zerarFreioDeAssinatura() {
  ultimaFalha.clear();
}
