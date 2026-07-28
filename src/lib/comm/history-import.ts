import { db } from "../db";
import {
  evolutionEnv,
  evoFindMessages,
  evoFindChats,
  evoGetMediaBase64,
  jidToPhone,
} from "./evolution";
import { normalizePhone, findCustomerByPhone } from "../intake";
import { lerMensagemWA } from "./wa-message";

/**
 * Importa o histórico RECENTE do WhatsApp (últimos N dias) que o servidor já
 * sincronizou ao conectar. Baixo risco: lê só o que o WhatsApp mandou sozinho
 * (como o WhatsApp Web) — não pede sincronização "a mais".
 *
 * Só texto (mídia antiga não vem). Cada conversa é casada com o cliente pelo
 * telefone. NÃO cria tarefa/oportunidade (é histórico, não lead novo).
 */

type WAMsg = {
  // senderPn: com a identidade nova do WhatsApp (@lid) o telefone real vem aqui
  key?: { remoteJid?: string; fromMe?: boolean; id?: string; senderPn?: string };
  pushName?: string;
  // a data chega em formatos diferentes conforme a versão do servidor:
  // segundos, milissegundos, texto numérico ou data ISO
  messageTimestamp?: number | string;
  timestamp?: number | string;
  createdAt?: string;
  messageTimestampMs?: number | string;
  // qualquer formato: quem interpreta é o leitor único (lib/comm/wa-message)
  message?: Record<string, unknown>;
};

/**
 * Data da mensagem, em milissegundos.
 *
 * O servidor manda a data de jeitos diferentes conforme a versão: segundos
 * (padrão do WhatsApp), milissegundos, texto numérico ou data ISO. Ler só um
 * formato fazia TODAS as mensagens caírem fora da janela de 30 dias — a
 * importação lia milhares e importava zero.
 */
export function dataDaMensagem(m: {
  messageTimestamp?: number | string;
  timestamp?: number | string;
  createdAt?: string;
  messageTimestampMs?: number | string;
}): number | null {
  const brutos = [m.messageTimestamp, m.timestamp, m.messageTimestampMs, m.createdAt];
  for (const bruto of brutos) {
    if (bruto === undefined || bruto === null || bruto === "") continue;
    const n = typeof bruto === "number" ? bruto : Number(bruto);
    if (Number.isFinite(n) && n > 0) {
      // < 1e12 é segundo (padrão do WhatsApp); acima já é milissegundo
      const ms = n < 1e12 ? n * 1000 : n;
      if (ms > 946_684_800_000) return ms; // a partir do ano 2000: data plausível
      continue;
    }
    if (typeof bruto === "string") {
      const iso = Date.parse(bruto);
      if (Number.isFinite(iso)) return iso;
    }
  }
  return null;
}

const MEDIA_BASE64_MAX = 12 * 1024 * 1024; // ~12 MB por mídia
const MEDIA_DOWNLOAD_BUDGET = 250; // teto de mídias baixadas por importação

/** Baixa a mídia (áudio/foto/vídeo/arquivo) e monta a data URL, com teto. */
async function baixarMidia(
  instance: string,
  messageId: string | undefined,
  mimeFallback: string | null
): Promise<string | null> {
  if (!messageId) return null;
  const res = await evoGetMediaBase64(instance, messageId);
  const b64 = res.data?.base64;
  if (!res.ok || !b64 || b64.length > MEDIA_BASE64_MAX) return null;
  const mime = (res.data?.mimetype || mimeFallback || "application/octet-stream").split(";")[0];
  return `data:${mime};base64,${b64}`;
}

/** Conversas lidas uma a uma (teto de segurança). */
const MAX_CHATS = 120;
/**
 * ORÇAMENTO DE TEMPO. A rota tem 5 minutos; paramos de VARRER aos 2min30 e de
 * GRAVAR aos 4min, devolvendo o que já deu. Antes, uma loja com muitas
 * conversas estourava o tempo e a tela mostrava só "não foi possível
 * importar" — perdendo tudo o que já tinha sido lido.
 */
const ORCAMENTO_VARRER_MS = 150_000;
const ORCAMENTO_TOTAL_MS = 240_000;

/** Extrai os identificadores das conversas devolvidas pelo servidor. */
export function extractJids(data: unknown): string[] {
  const d = data as Record<string, unknown> | unknown[] | null;
  const lista: unknown[] = Array.isArray(d)
    ? d
    : d && typeof d === "object"
      ? ((d as Record<string, unknown>).chats as unknown[]) ??
        ((d as Record<string, unknown>).records as unknown[]) ??
        []
      : [];
  const jids: string[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const jid = [o.remoteJid, o.id, o.jid].find((v) => typeof v === "string") as
      | string
      | undefined;
    // só conversas de PESSOA: grupos (@g.us) e status ficam de fora. O "@lid"
    // é a identidade nova do WhatsApp — sem ele, conversas inteiras sumiam.
    const ehPessoa = !!jid && (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));
    if (jid && ehPessoa && !jids.includes(jid)) jids.push(jid);
  }
  return jids;
}

/** Extrai a lista de mensagens de formatos variados de resposta do servidor. */
export function extractRecords(data: unknown): WAMsg[] {
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
  semData: number; // vieram sem data legível
  naJanela: number; // dentro dos N dias pedidos
};

export async function importRecentHistory(
  companyId: string,
  days = 30
): Promise<HistoryImportResult> {
  const inicio = Date.now();
  const settings = await db.commSettings.findUnique({ where: { companyId } });
  if (!settings?.evolutionInstance || !evolutionEnv().configured)
    throw new Error("WhatsApp não conectado. Conecte o número em Comunicação.");

  const res = await evoFindMessages(settings.evolutionInstance);
  const geral = extractRecords(res.data);
  let via = "geral";
  let lidas = 0;
  let chatsEncontrados = 0;

  // A leitura geral costuma devolver só um PEDAÇO (uma página, poucas
  // conversas). Por isso varremos SEMPRE conversa por conversa e juntamos:
  // antes, bastava a geral trazer 2 conversas para as outras nunca serem
  // lidas — e a importação parecia "vazia" mesmo com histórico guardado.
  const porId = new Map<string, WAMsg>();
  const guardar = (lista: WAMsg[]) => {
    for (const m of lista) {
      const id = m.key?.id ?? `${m.key?.remoteJid ?? ""}-${m.messageTimestamp ?? ""}`;
      if (!porId.has(id)) porId.set(id, m);
    }
  };
  guardar(geral);

  if (res.ok) {
    const chats = await evoFindChats(settings.evolutionInstance);
    const todos = extractJids(chats.data);
    chatsEncontrados = todos.length;
    const jids = todos.slice(0, MAX_CHATS);
    for (const jid of jids) {
      if (Date.now() - inicio > ORCAMENTO_VARRER_MS) {
        via = "parcial-tempo";
        break; // acabou o tempo de varredura: importa o que já leu
      }
      const r = await evoFindMessages(settings.evolutionInstance, {
        remoteJid: jid,
        offset: 300,
      });
      guardar(extractRecords(r.data));
      lidas++;
      if (porId.size >= 8000) break; // teto de segurança
    }
    if (via !== "parcial-tempo") via = geral.length ? "geral+conversas" : "por-conversa";
  }
  const records = [...porId.values()];

  // diagnóstico (aparece na Central de Comunicação): mostra o que o servidor
  // respondeu — se veio 0, sabemos se é config do servidor ou formato da leitura
  const shape = Array.isArray(res.data)
    ? `array(${(res.data as unknown[]).length})`
    : res.data && typeof res.data === "object"
      ? `keys:${Object.keys(res.data as object).join(",")}`
      : typeof res.data;
  if (!res.ok)
    throw new Error(
      `O servidor recusou a leitura do histórico (HTTP ${res.status}).`
    );

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // filtra pela janela e ordena do mais antigo pro mais novo (cronológico)
  const comData = records
    .map((r) => ({ r, ts: dataDaMensagem(r) }))
    .filter((x): x is { r: WAMsg; ts: number } => x.ts !== null);
  const semData = records.length - comData.length;
  const parsed = comData
    .filter((x) => x.ts >= cutoff && x.ts <= Date.now() + 60_000)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 3000); // teto de segurança

  // diagnóstico depois de filtrar: assim ele diz não só quanto o servidor
  // devolveu, mas quantas mensagens tinham data legível e quantas caíram
  // dentro da janela — é o que revela um filtro comendo tudo em silêncio
  const maisNova = comData.length
    ? new Date(Math.max(...comData.map((x) => x.ts))).toISOString().slice(0, 10)
    : null;
  await db.commEvent
    .create({
      data: {
        companyId,
        channel: "WHATSAPP",
        direction: "IN",
        type: "wa.historico.leitura",
        status: "OK",
        payload: JSON.stringify({
          httpStatus: res.status,
          shape,
          via,
          chatsEncontrados,
          conversasVarridas: lidas,
          registrosGeral: geral.length,
          registros: records.length,
          semDataLegivel: semData,
          dentroDaJanela: parsed.length,
          mensagemMaisNova: maisNova,
        }).slice(0, 500),
      },
    })
    .catch(() => {});

  let importadas = 0;
  let midiaBudget = MEDIA_DOWNLOAD_BUDGET;
  const instance = settings.evolutionInstance;
  const convByCustomer = new Map<string, string>();

  for (const { r, ts } of parsed) {
    if (Date.now() - inicio > ORCAMENTO_TOTAL_MS) break; // devolve o que já gravou
    // grupos/status ficam de fora; contato @lid usa o número real do senderPn
    const jid = r.key?.remoteJid ?? "";
    let phone = jidToPhone(jid);
    if (!phone && jid.endsWith("@lid")) {
      const pn = (r.key?.senderPn ?? "").split("@")[0].replace(/\D/g, "");
      if (/^\d{8,15}$/.test(pn)) phone = pn;
    }
    if (!phone) continue;
    const { text, mediaType, mimeFallback, fileName } = lerMensagemWA(r);
    if (!text) continue;
    const extId = r.key?.id;

    // cliente (casa 9º dígito/DDI/formatação; cria se não existir — sem lead/tarefa)
    let customer = await findCustomerByPhone(companyId, phone);
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

    // mídia (áudio/foto/vídeo/arquivo): baixa o conteúdo, respeitando o teto
    let mediaUrl: string | null = null;
    if (mediaType !== "TEXT" && midiaBudget > 0) {
      mediaUrl = await baixarMidia(instance, extId, mimeFallback);
      if (mediaUrl) midiaBudget--;
    }

    await db.message.create({
      data: {
        conversationId: convId,
        channel: "WHATSAPP",
        direction: r.key?.fromMe ? "OUT" : "IN",
        body: text,
        ...(mediaType !== "TEXT" && mediaUrl
          ? { mediaType, mediaUrl, fileName }
          : {}),
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
    semData,
    naJanela: parsed.length,
  };
}
