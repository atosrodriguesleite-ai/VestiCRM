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
 *  2. Trava anti-banimento no envio: espaçamento mínimo entre mensagens e
 *     teto diário por loja (checkSendAllowance) — vale para TODO envio via
 *     engine (caixa de entrada, automações, campanhas).
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

// ---- Limites anti-banimento ------------------------------------------------

export const WA_GAP_SEGUNDOS = 5; // espaçamento mínimo entre envios da loja
export const WA_TETO_DIARIO = 300; // envios/dia por loja (conexão não oficial)

/**
 * Verifica e consome a "licença de envio" da loja (só para EVOLUTION).
 * Devolve ok=false com mensagem amigável quando o limite seguraria o envio.
 */
export async function checkSendAllowance(
  companyId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await db.commSettings.findUnique({ where: { companyId } });
  if (!s) return { ok: true };

  const hoje = new Date().toISOString().slice(0, 10);
  const enviadosHoje = s.waSentDate === hoje ? s.waSentToday : 0;

  if (enviadosHoje >= WA_TETO_DIARIO) {
    return {
      ok: false,
      error: `Limite diário de segurança atingido (${WA_TETO_DIARIO} envios). O contador zera à meia-noite — o limite protege seu número contra bloqueio.`,
    };
  }
  if (s.waLastSentAt && Date.now() - s.waLastSentAt.getTime() < WA_GAP_SEGUNDOS * 1000) {
    const falta = Math.ceil(
      (WA_GAP_SEGUNDOS * 1000 - (Date.now() - s.waLastSentAt.getTime())) / 1000
    );
    return {
      ok: false,
      error: `Aguarde ${falta}s entre envios — o espaçamento protege seu número contra bloqueio.`,
    };
  }

  await db.commSettings.update({
    where: { companyId },
    data: { waLastSentAt: new Date(), waSentDate: hoje, waSentToday: enviadosHoje + 1 },
  });
  return { ok: true };
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
