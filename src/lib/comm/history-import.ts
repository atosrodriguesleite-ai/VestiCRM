import { db } from "../db";
import { evolutionEnv, evoFindMessages, jidToPhone } from "./evolution";
import { normalizePhone, phoneMatchVariants } from "../intake";

/**
 * Importa o histórico RECENTE do WhatsApp (últimos N dias) que o servidor já
 * sincronizou ao conectar. Baixo risco: lê só o que o WhatsApp mandou sozinho
 * (como o WhatsApp Web) — não pede sincronização "a mais".
 *
 * Só texto (mídia antiga não vem). Cada conversa é casada com o cliente pelo
 * telefone. NÃO cria tarefa/oportunidade (é histórico, não lead novo).
 */

type WAMsg = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  messageTimestamp?: number | string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { fileName?: string };
    audioMessage?: unknown;
    stickerMessage?: unknown;
  };
};

function textOf(m: WAMsg): string {
  const msg = m.message ?? {};
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage) return msg.imageMessage.caption || "[foto]";
  if (msg.videoMessage) return msg.videoMessage.caption || "[vídeo]";
  if (msg.audioMessage) return "[áudio]";
  if (msg.documentMessage)
    return `[arquivo] ${msg.documentMessage.fileName ?? ""}`.trim();
  if (msg.stickerMessage) return "[figurinha]";
  return "";
}

/** Extrai a lista de mensagens de formatos variados de resposta do servidor. */
function extractRecords(data: unknown): WAMsg[] {
  const d = data as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(d)) return d as WAMsg[];
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (Array.isArray(o.messages)) return o.messages as WAMsg[];
    if (Array.isArray(o.records)) return o.records as WAMsg[];
    const msgs = o.messages as Record<string, unknown> | undefined;
    if (msgs && Array.isArray(msgs.records)) return msgs.records as WAMsg[];
  }
  return [];
}

export type HistoryImportResult = {
  importadas: number;
  conversas: number;
  encontradas: number;
};

export async function importRecentHistory(
  companyId: string,
  days = 7
): Promise<HistoryImportResult> {
  const settings = await db.commSettings.findUnique({ where: { companyId } });
  if (!settings?.evolutionInstance || !evolutionEnv().configured)
    throw new Error("WhatsApp não conectado. Conecte o número em Comunicação.");

  const res = await evoFindMessages(settings.evolutionInstance);
  if (!res.ok)
    throw new Error("Não foi possível ler o histórico do servidor de conexão.");

  const records = extractRecords(res.data);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // filtra pela janela e ordena do mais antigo pro mais novo (cronológico)
  const parsed = records
    .map((r) => ({ r, ts: Number(r.messageTimestamp ?? 0) * 1000 }))
    .filter((x) => x.ts >= cutoff && x.ts <= Date.now() + 60_000)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 3000); // teto de segurança

  let importadas = 0;
  const convByCustomer = new Map<string, string>();

  for (const { r, ts } of parsed) {
    const phone = jidToPhone(r.key?.remoteJid ?? ""); // grupos/status ficam de fora
    if (!phone) continue;
    const text = textOf(r);
    if (!text) continue;
    const extId = r.key?.id;

    // cliente (casa com/sem 9º dígito; cria se não existir — sem lead/tarefa)
    let customer = await db.customer.findFirst({
      where: { companyId, phone: { in: phoneMatchVariants(phone) } },
      orderBy: { createdAt: "asc" },
    });
    if (!customer) {
      customer = await db.customer.create({
        data: {
          companyId,
          name: r.pushName?.trim() || `Contato ${phone.slice(-4)}`,
          phone: normalizePhone(phone),
          origin: "WHATSAPP",
        },
      });
    }

    // conversa: reaproveita a do cliente ou cria uma (histórico entra fechado,
    // aparecendo na aba Contatos, para não inundar a fila de atendimento)
    let convId = convByCustomer.get(customer.id);
    if (!convId) {
      let conv = await db.conversation.findFirst({
        where: { companyId, customerId: customer.id },
        orderBy: { lastMessageAt: "desc" },
      });
      if (!conv) {
        conv = await db.conversation.create({
          data: {
            companyId,
            customerId: customer.id,
            channel: "WHATSAPP",
            status: "CLOSED",
            lastMessageAt: new Date(ts),
          },
        });
      }
      convId = conv.id;
      convByCustomer.set(customer.id, convId);
    }

    // dedup: não reimporta a mesma mensagem
    if (extId) {
      const exists = await db.message.findFirst({
        where: { conversationId: convId, externalId: extId },
        select: { id: true },
      });
      if (exists) continue;
    }

    await db.message.create({
      data: {
        conversationId: convId,
        channel: "WHATSAPP",
        direction: r.key?.fromMe ? "OUT" : "IN",
        body: text,
        externalId: extId,
        status: r.key?.fromMe ? "ENVIADA" : "RECEBIDA",
        createdAt: new Date(ts),
      },
    });
    importadas++;
  }

  // acerta o "última mensagem" de cada conversa importada
  for (const convId of convByCustomer.values()) {
    const last = await db.message.findFirst({
      where: { conversationId: convId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last)
      await db.conversation.update({
        where: { id: convId },
        data: { lastMessageAt: last.createdAt },
      });
  }

  return {
    importadas,
    conversas: convByCustomer.size,
    encontradas: records.length,
  };
}
