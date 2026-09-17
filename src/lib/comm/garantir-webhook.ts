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

// freio: instância → quando foi a última tentativa que FALHOU, e por quê
const ultimaFalha = new Map<string, { em: number; motivo: string }>();
export const MS_FREIO_APOS_FALHA = 10 * 60 * 1000;

/** O motivo da última recusa do servidor (para a tela de conexão dizer). */
export function motivoDaUltimaFalha(instance: string | null): string | null {
  return (instance && ultimaFalha.get(instance)?.motivo) || null;
}

function descreverRecusa(r: { status: number; data: unknown; incerto?: boolean }): string {
  if (r.incerto) return "o servidor demorou demais para responder";
  if (r.status === 0) return "não deu para falar com o servidor";
  const corpo = r.data ? JSON.stringify(r.data).slice(0, 300) : "";
  return `o servidor respondeu ${r.status}${corpo ? `: ${corpo}` : ""}`;
}

/**
 * Recusa NÃO fica calada: vai para a Central de Comunicação com a resposta
 * crua do servidor (é o que diz, por exemplo, que a versão instalada não
 * conhece o evento) — uma vez por rodada de freio, nunca a cada mensagem.
 */
async function registrarRecusa(s: AssinaturaDaLoja, motivo: string) {
  await db.commEvent
    .create({
      data: {
        companyId: s.companyId,
        channel: "WHATSAPP",
        direction: "OUT",
        type: "wa.webhook.assinatura-recusada",
        status: "ERRO",
        error: `O servidor do WhatsApp recusou a assinatura dos eventos atuais (${motivo}). Sem ela, edição e apagar de mensagem podem não chegar à Central.`,
        payload: JSON.stringify({ instance: s.evolutionInstance, eventos: WEBHOOK_EVENTOS_ATUAIS }),
      },
    })
    .catch(() => {});
}

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
  if (!opts.sempre && falhouHaPouco && agora - falhouHaPouco.em < MS_FREIO_APOS_FALHA) {
    return "em-freio";
  }
  try {
    const r = await evoSetWebhook(s.evolutionInstance, s.evolutionWebhookToken);
    if (!r.ok) {
      const motivo = descreverRecusa(r);
      ultimaFalha.set(s.evolutionInstance, { em: agora, motivo });
      await registrarRecusa(s, motivo);
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
  } catch (e) {
    const motivo = `erro inesperado: ${e instanceof Error ? e.message : String(e)}`;
    ultimaFalha.set(s.evolutionInstance, { em: agora, motivo });
    await registrarRecusa(s, motivo);
    return "falhou";
  }
}

/** Só para teste: esquece o freio. */
export function _zerarFreioDeAssinatura() {
  ultimaFalha.clear();
}
