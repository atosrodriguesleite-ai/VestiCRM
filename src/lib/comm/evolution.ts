import crypto from "crypto";
import { db } from "../db";

/**
 * WhatsApp SEM API oficial — conexão estilo "WhatsApp Web que nunca fecha",
 * via servidor Evolution API (self-hosted, configurado nas variáveis de
 * ambiente da plataforma). Cada loja tem UMA instância própria.
 *
 * Segurança em camadas:
 *  1. Termo de aceite obrigatório ANTES do QR (registro permanente em
 *     WhatsappConsent: quem, quando, IP, versão do texto).
 *  2. Proteção anti-banimento SEM travar o vendedor (janela de atendimento):
 *     resposta a quem chamou (24h) sai na hora; só o envio proativo/frio
 *     recebe um ritmo humano com intervalo variável (paceProactiveSend).
 *     Não há teto de mensagens — venda consultiva precisa de volume.
 *  3. Webhook autenticado por token único por loja (rota /webhook/[token]).
 *
 * O modo com API oficial (Meta Cloud API) continua existindo ao lado — a
 * loja escolhe o provedor; o resto do sistema não muda.
 */

// ---- Termo de aceite -------------------------------------------------------

export const TERMO_WA_VERSAO = "1.0";

export const TERMO_WA_TEXTO = `TERMO DE USO — CONEXÃO DE WHATSAPP SEM API OFICIAL (v${TERMO_WA_VERSAO})

1. COMO FUNCIONA. Esta conexão liga o número de WhatsApp da sua loja ao
sistema por tecnologia equivalente ao WhatsApp Web ("conexão não oficial").
Ela NÃO utiliza a API oficial da Meta.

2. RISCO DE BLOQUEIO. O uso de conexões não oficiais viola os termos de
serviço do WhatsApp/Meta. A Meta pode suspender temporariamente ou BANIR
DEFINITIVAMENTE o número conectado, A QUALQUER MOMENTO E SEM AVISO PRÉVIO,
a critério exclusivo dela. O risco aumenta muito com disparos em massa para
pessoas que não iniciaram conversa com a loja.

3. RECOMENDAÇÕES DE SEGURANÇA. (a) Use um número DEDICADO à loja, e não o
número pessoal; (b) número novo deve ser "aquecido": usado normalmente no
aplicativo por 1 a 2 semanas antes de conectar; (c) priorize responder quem
chamou primeiro; evite mensagens frias em volume; (d) o sistema aplica
espaçamento mínimo entre envios e um teto diário por segurança — esses
limites fazem parte desta proteção e não devem ser contornados.

4. RESPONSABILIDADE. A escolha pela conexão não oficial é do lojista. A
plataforma não controla e não responde pelas decisões da Meta, incluindo
suspensões ou banimentos do número, nem por perdas decorrentes. Para
operação sem esse risco, a plataforma oferece (ou oferecerá) o modo com a
API oficial da Meta, com custos próprios da Meta.

5. DADOS. As conversas trafegam pelo servidor de conexão da plataforma
exclusivamente para funcionamento do CRM (recebimento, envio e histórico) e
são armazenadas com o mesmo sigilo dos demais dados da loja.

6. REGISTRO. Este aceite fica registrado (nome, usuário, data/hora, IP e
versão deste texto) como comprovação de ciência dos pontos acima.`;

export const TERMO_WA_SHA = crypto
  .createHash("sha256")
  .update(TERMO_WA_TEXTO)
  .digest("hex")
  .slice(0, 16);

// ---- Ritmo de envio anti-bloqueio -----------------------------------------
// Filosofia: RESPOSTA a quem te chamou (janela de 24h) sai NA HORA — é o grosso
// do atendimento e é baixo risco. Só o envio PROATIVO/frio (primeiro contato,
// disparo) recebe um "ritmo humano" (intervalo variável) pra o número não
// parecer robô. NÃO há teto fixo de mensagens: venda consultiva precisa de
// volume. Isso protege o número sem travar o vendedor.

export const WA_JANELA_HORAS = 24; // janela de atendimento (o cliente falou primeiro)
export const WA_GAP_MIN_SEG = 4; // ritmo humano dos envios proativos — mínimo
export const WA_GAP_MAX_SEG = 9; // ritmo humano dos envios proativos — máximo

/**
 * Aplica o "ritmo humano" a um envio PROATIVO (frio): espera um intervalo
 * VARIÁVEL desde o último envio da loja e registra o horário. Espera no
 * servidor (não devolve erro), então nunca "trava" o vendedor com um aviso.
 * Respostas dentro da janela de atendimento NÃO chamam esta função (saem já).
 */
export async function paceProactiveSend(companyId: string): Promise<void> {
  const s = await db.commSettings.findUnique({ where: { companyId } });
  if (!s) return;
  const gapMs =
    (WA_GAP_MIN_SEG + Math.random() * (WA_GAP_MAX_SEG - WA_GAP_MIN_SEG)) * 1000;
  if (s.waLastSentAt) {
    const desde = Date.now() - s.waLastSentAt.getTime();
    if (desde < gapMs) await new Promise((r) => setTimeout(r, gapMs - desde));
  }
  const hoje = new Date().toISOString().slice(0, 10);
  await db.commSettings.update({
    where: { companyId },
    data: {
      waLastSentAt: new Date(),
      waSentDate: hoje,
      waSentToday: (s.waSentDate === hoje ? s.waSentToday : 0) + 1, // contador só informativo
    },
  });
}

// ---- Cliente do servidor Evolution ----------------------------------------

export function evolutionEnv() {
  const url = process.env.EVOLUTION_URL?.trim().replace(/\/$/, "") || null;
  const key = process.env.EVOLUTION_KEY?.trim() || null;
  return { url, key, configured: Boolean(url && key) };
}

export function appBaseUrl() {
  return (
    process.env.APP_URL?.trim().replace(/\/$/, "") ||
    process.env.MAIN_SITE_URL?.trim().replace(/\/$/, "") ||
    "https://www.atacadopro.com"
  );
}

async function evo<T = Record<string, unknown>>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  timeoutMs = 45_000
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { url, key } = evolutionEnv();
  if (!url || !key) return { ok: false, status: 0, data: null };
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: key },
      ...(body ? { body: JSON.stringify(body) } : {}),
      // teto de segurança: mídia grande + conversão demoram, mas nunca podem
      // segurar a função até ser morta no meio (erro na tela + envio no ar)
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// mídia demora mais que texto (upload + conversão no servidor de conexão) —
// ganha um teto maior, ainda dentro do orçamento da função (60s)
const EVO_MEDIA_TIMEOUT_MS = 50_000;
// LEITURA de conversas/mensagens: é rápida por natureza. Teto curto de
// propósito — a importação lê dezenas de conversas em sequência, e uma só
// travando por 50s comeria o orçamento inteiro da importação.
const EVO_LEITURA_TIMEOUT_MS = 15_000;

/** Eventos que a loja precisa receber (inclui apagar/editar do cliente). */
export const WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE", // cliente apagou uma mensagem
] as const;

function webhookUrl(webhookToken: string) {
  return `${appBaseUrl()}/api/whatsapp/evolution/webhook/${webhookToken}`;
}

/** Cria (ou garante) a instância da loja, já apontando o webhook pra cá. */
export async function evoCreateInstance(instance: string, webhookToken: string) {
  return evo("POST", "/instance/create", {
    instanceName: instance,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    webhook: {
      url: webhookUrl(webhookToken),
      byEvents: false,
      events: [...WEBHOOK_EVENTS],
    },
  });
}

/**
 * Atualiza o webhook de uma instância JÁ criada (ex.: para passar a receber
 * um evento novo sem precisar reconectar). Best-effort — falha em silêncio.
 */
export async function evoSetWebhook(instance: string, webhookToken: string) {
  // mesmo formato de campos que a criação da instância aceita nesta versão
  // do servidor (byEvents/base64, dentro do wrapper "webhook")
  return evo("POST", `/webhook/set/${instance}`, {
    webhook: {
      enabled: true,
      url: webhookUrl(webhookToken),
      byEvents: false,
      base64: false,
      events: [...WEBHOOK_EVENTS],
    },
  });
}

/** Pede o QR Code de conexão (base64) da instância. */
export async function evoConnect(instance: string) {
  return evo<{ base64?: string; code?: string }>("GET", `/instance/connect/${instance}`);
}

/** Estado atual da conexão: open | connecting | close. */
export async function evoState(instance: string) {
  return evo<{ instance?: { state?: string; ownerJid?: string } }>(
    "GET",
    `/instance/connectionState/${instance}`
  );
}

/** JID do WhatsApp a partir de um telefone (só dígitos). */
export const jidDeNumero = (phone: string) =>
  `${phone.replace(/\D/g, "")}@s.whatsapp.net`;

/**
 * Dados da mensagem CITADA numa resposta.
 *
 * O WhatsApp não aceita citação pela metade: além do id, a citação precisa
 * dizer DE QUEM é a mensagem original (`remoteJid` + `fromMe`) e o conteúdo
 * dela. Mandando só o id, o aparelho recebe uma citação sem autor — e a
 * mensagem pode encalhar no celular da loja como "Aguardando mensagem".
 */
export type CitacaoWA = {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  texto?: string;
};

const corpoDaCitacao = (c: CitacaoWA) =>
  c.texto?.trim() ? { message: { conversation: c.texto.slice(0, 1000) } } : {};

/** Envia texto pelo número conectado da loja (com citação opcional). */
export async function evoSendText(
  instance: string,
  number: string,
  text: string,
  citacao?: CitacaoWA
) {
  return evo<{ key?: { id?: string } }>("POST", `/message/sendText/${instance}`, {
    number,
    text,
    // responder mensagem específica: o WhatsApp mostra a citação em cima
    ...(citacao
      ? {
          quoted: {
            key: { remoteJid: citacao.remoteJid, fromMe: citacao.fromMe, id: citacao.id },
            ...corpoDaCitacao(citacao),
          },
        }
      : {}),
  });
}

/**
 * Envia mídia (imagem/vídeo/documento) pelo número conectado. Aceita data URL
 * (base64) — o comum aqui — ou uma URL http pública. Extrai o mimetype/base64.
 */
/**
 * Separa uma data URL em mime + base64. O mime do navegador pode vir com
 * parâmetros ("audio/webm;codecs=opus"), então o corte é no ";base64," — não
 * no primeiro ";" (isso mandava o arquivo malformado e o WhatsApp recusava).
 */
export function splitDataUrl(
  v: string
): { mimetype: string | null; base64: string } | null {
  const m = v.match(/^data:([^,]*?);base64,([\s\S]*)$/);
  if (!m) return null;
  return { mimetype: m[1] ? m[1].split(";")[0] : null, base64: m[2] };
}

export async function evoSendMedia(
  instance: string,
  number: string,
  kind: "image" | "video" | "document",
  dataUrlOrLink: string,
  fileName?: string,
  caption?: string
) {
  const parts = splitDataUrl(dataUrlOrLink);
  const mimetype = parts?.mimetype ?? undefined;
  const media = parts ? parts.base64 : dataUrlOrLink; // base64 puro ou link http
  return evo<{ key?: { id?: string } }>(
    "POST",
    `/message/sendMedia/${instance}`,
    {
      number,
      mediatype: kind,
      ...(mimetype ? { mimetype } : {}),
      ...(fileName ? { fileName } : {}),
      ...(caption ? { caption } : {}),
      media,
    },
    EVO_MEDIA_TIMEOUT_MS
  );
}

/**
 * Envia áudio de voz (PTT) pelo número conectado (data URL base64 ou link).
 * `encoding: true` faz o servidor converter para o formato de voz do WhatsApp
 * (ogg/opus) — o navegador grava em webm, que o WhatsApp recusa sem conversão.
 */
export async function evoSendAudio(
  instance: string,
  number: string,
  dataUrlOrLink: string
) {
  const audio = splitDataUrl(dataUrlOrLink)?.base64 ?? dataUrlOrLink;
  return evo<{ key?: { id?: string } }>(
    "POST",
    `/message/sendWhatsAppAudio/${instance}`,
    { number, audio, encoding: true },
    EVO_MEDIA_TIMEOUT_MS
  );
}

/**
 * Baixa a mídia de uma mensagem recebida (foto, áudio, vídeo, arquivo) em
 * base64 — o webhook só avisa que a mídia existe; o arquivo vem por aqui.
 */
export async function evoGetMediaBase64(instance: string, messageId: string) {
  return evo<{ base64?: string; mimetype?: string; fileName?: string }>(
    "POST",
    `/chat/getBase64FromMediaMessage/${instance}`,
    { message: { key: { id: messageId } }, convertToMp4: false }
  );
}

/** Desconecta e remove a instância (o número volta a ser só do celular). */
export async function evoLogout(instance: string) {
  await evo("DELETE", `/instance/logout/${instance}`);
  return evo("DELETE", `/instance/delete/${instance}`);
}

/** JID de contato (1:1) a partir de um telefone BR (assume 55 sem DDI). */
export function phoneToJid(phone: string): string {
  const num = (phone ?? "").replace(/\D/g, "");
  const full = num.length <= 11 ? `55${num}` : num;
  return `${full}@s.whatsapp.net`;
}

/**
 * Apaga a mensagem "para todos" (some do celular do cliente). O WhatsApp só
 * permite por um tempo limitado (~2 dias) após o envio.
 */
export async function evoDeleteForEveryone(
  instance: string,
  key: { id: string; remoteJid: string; fromMe: boolean }
) {
  return evo("DELETE", `/chat/deleteMessageForEveryone/${instance}`, key);
}

/**
 * Edita o texto de uma mensagem já enviada. O WhatsApp só permite editar até
 * ~15 minutos após o envio (regra da Meta).
 */
export async function evoEditMessage(
  instance: string,
  number: string,
  key: { id: string; remoteJid: string; fromMe: boolean },
  text: string
) {
  return evo<{ key?: { id?: string } }>("POST", `/chat/updateMessage/${instance}`, {
    number,
    key,
    text,
  });
}

/**
 * Lê as mensagens que o servidor já tem guardadas da instância (o WhatsApp
 * sincroniza um lote recente ao conectar — igual ao WhatsApp Web). Usado para
 * importar o histórico recente sem pedir sincronização "a mais" (baixo risco).
 */
export async function evoFindMessages(
  instance: string,
  opts?: { remoteJid?: string; page?: number; offset?: number }
) {
  return evo<unknown>(
    "POST",
    `/chat/findMessages/${instance}`,
    {
      // versões novas do servidor exigem a conversa no filtro para devolver
      // mensagens; sem `remoteJid` a leitura "geral" costuma vir vazia
      where: opts?.remoteJid ? { key: { remoteJid: opts.remoteJid } } : {},
      page: opts?.page ?? 1,
      offset: opts?.offset ?? 500,
    },
    EVO_LEITURA_TIMEOUT_MS
  );
}

/** Lista as conversas que o servidor tem guardadas (para ler uma a uma). */
export async function evoFindChats(instance: string) {
  return evo<unknown>("POST", `/chat/findChats/${instance}`, {}, EVO_LEITURA_TIMEOUT_MS);
}

/**
 * TODOS os contatos que o servidor conhece — vem com a foto de perfil junto.
 *
 * É a chamada barata: UMA consulta traz a agenda inteira com as fotos, em vez
 * de uma consulta por cliente. O que faltar aqui (contato que o servidor
 * ainda não viu) é buscado um a um, com parcimônia.
 */
export async function evoFindContacts(instance: string) {
  return evo<unknown>("POST", `/chat/findContacts/${instance}`, {}, EVO_LEITURA_TIMEOUT_MS);
}

/** Foto de perfil de UM número (usada só para preencher o que faltou). */
export async function evoProfilePicture(instance: string, number: string) {
  return evo<{ profilePictureUrl?: string | null }>(
    "POST",
    `/chat/fetchProfilePictureUrl/${instance}`,
    { number },
    EVO_LEITURA_TIMEOUT_MS
  );
}

/** Extrai o telefone (dígitos) de um JID "5511999999999@s.whatsapp.net". */
export function jidToPhone(jid: string): string | null {
  const m = jid.match(/^(\d{8,15})@s\.whatsapp\.net$/);
  return m ? m[1] : null; // grupos (@g.us) e afins ficam de fora
}
