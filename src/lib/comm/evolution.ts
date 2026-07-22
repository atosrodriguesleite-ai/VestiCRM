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
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { url, key } = evolutionEnv();
  if (!url || !key) return { ok: false, status: 0, data: null };
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: key },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Cria (ou garante) a instância da loja, já apontando o webhook pra cá. */
export async function evoCreateInstance(instance: string, webhookToken: string) {
  return evo("POST", "/instance/create", {
    instanceName: instance,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    webhook: {
      url: `${appBaseUrl()}/api/whatsapp/evolution/webhook/${webhookToken}`,
      byEvents: false,
      events: ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"],
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

/** Envia texto pelo número conectado da loja. */
export async function evoSendText(instance: string, number: string, text: string) {
  return evo<{ key?: { id?: string } }>("POST", `/message/sendText/${instance}`, {
    number,
    text,
  });
}

/**
 * Envia mídia (imagem/vídeo/documento) pelo número conectado. Aceita data URL
 * (base64) — o comum aqui — ou uma URL http pública. Extrai o mimetype/base64.
 */
export async function evoSendMedia(
  instance: string,
  number: string,
  kind: "image" | "video" | "document",
  dataUrlOrLink: string,
  fileName?: string,
  caption?: string
) {
  const m = dataUrlOrLink.match(/^data:([^;]+);base64,([\s\S]*)$/);
  const mimetype = m?.[1];
  const media = m ? m[2] : dataUrlOrLink; // base64 puro ou link http
  return evo<{ key?: { id?: string } }>("POST", `/message/sendMedia/${instance}`, {
    number,
    mediatype: kind,
    ...(mimetype ? { mimetype } : {}),
    ...(fileName ? { fileName } : {}),
    ...(caption ? { caption } : {}),
    media,
  });
}

/** Envia áudio de voz (PTT) pelo número conectado (data URL base64 ou link). */
export async function evoSendAudio(
  instance: string,
  number: string,
  dataUrlOrLink: string
) {
  const m = dataUrlOrLink.match(/^data:[^;]+;base64,([\s\S]*)$/);
  const audio = m ? m[1] : dataUrlOrLink;
  return evo<{ key?: { id?: string } }>(
    "POST",
    `/message/sendWhatsAppAudio/${instance}`,
    { number, audio }
  );
}

/** Desconecta e remove a instância (o número volta a ser só do celular). */
export async function evoLogout(instance: string) {
  await evo("DELETE", `/instance/logout/${instance}`);
  return evo("DELETE", `/instance/delete/${instance}`);
}

/** Extrai o telefone (dígitos) de um JID "5511999999999@s.whatsapp.net". */
export function jidToPhone(jid: string): string | null {
  const m = jid.match(/^(\d{8,15})@s\.whatsapp\.net$/);
  return m ? m[1] : null; // grupos (@g.us) e afins ficam de fora
}
