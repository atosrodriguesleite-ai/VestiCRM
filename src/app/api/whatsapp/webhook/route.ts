import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { receiveMessage, updateDeliveryStatus } from "@/lib/comm/engine";

/**
 * Webhook do WhatsApp — Communication Engine.
 *
 * GET  → verificação da Meta (hub.challenge) usando o Verify Token salvo em
 *        Configurações → Comunicação. Já funciona no padrão oficial.
 * POST → mensagens recebidas e recibos de status, nos DOIS formatos:
 *        o oficial da Meta Cloud API (entry[].changes[].value, com validação
 *        de assinatura X-Hub-Signature-256) e o simulado (testes internos).
 */

/**
 * Janela do aviso de recusa. A loja precisa descobrir POR QUE as mensagens
 * não estão entrando — uma vez a cada 15 minutos basta para isso, e impede
 * que a porta vire um jeito de encher o banco de quem não tem senha nenhuma.
 */
const MS_ENTRE_AVISOS_DE_RECUSA = 15 * 60_000;

/** Compara dois segredos sem entregar o tamanho nem o conteúdo pelo relógio. */
function tokenConfere(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  // comprimentos diferentes: `timingSafeEqual` LANÇA em vez de devolver
  // false, então o tamanho é conferido antes (ele já vaza pelo tamanho da
  // requisição de qualquer jeito — o conteúdo é que não pode vazar).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const all = await db.commSettings.findMany({
    where: { verifyToken: { not: null } },
  });
  // compara com o verify token de qualquer empresa configurada.
  //
  // TEMPO CONSTANTE: `===` em texto secreto para de comparar no primeiro
  // caractere diferente, e a diferença de tempo é medível — dá para
  // descobrir o token letra por letra. `timingSafeEqual` sempre percorre
  // tudo. (E percorre a lista INTEIRA de propósito: sair no primeiro acerto
  // devolveria a resposta mais rápido para tokens quase certos.)
  let match = false;
  for (const s of all) {
    if (tokenConfere(decryptSecret(s.verifyToken!), token)) match = true;
  }
  if (!match) {
    return NextResponse.json({ error: "Verify token inválido" }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

const messageSchema = z.object({
  company: z.string().min(1),
  phone: z.string().min(8),
  name: z.string().optional(),
  text: z.string().min(1),
  mediaType: z
    .enum(["TEXT", "IMAGE", "AUDIO", "DOCUMENT", "VIDEO"])
    .optional(),
  mediaUrl: z.string().optional(),
  fileName: z.string().optional(),
  externalId: z.string().optional(),
});

const statusSchema = z.object({
  company: z.string().min(1),
  statusUpdate: z.object({
    externalId: z.string().min(1),
    status: z.enum(["ENTREGUE", "LIDA", "FALHOU"]),
    error: z.string().optional(),
  }),
});

/** Payload oficial da Meta → mensagens e recibos para a engine. */
async function handleMetaPayload(raw: string, signature: string | null) {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = body as {
    object?: string;
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { wa_id?: string; profile?: { name?: string } }[];
          messages?: {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
            button?: { text?: string };
            interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
            image?: { caption?: string };
            video?: { caption?: string };
            document?: { filename?: string; caption?: string };
          }[];
          statuses?: { id?: string; status?: string; errors?: { message?: string }[] }[];
        };
      }[];
    }[];
  };
  if (root.object !== "whatsapp_business_account") return null;

  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;

      // resolve a loja dona deste número
      const settings = await db.commSettings.findFirst({
        where: { phoneNumberId },
      });
      if (!settings) continue;

      // ASSINATURA OBRIGATÓRIA — FAIL-CLOSED.
      //
      // Aqui a validação só acontecia SE a loja tivesse App Secret salvo.
      // Sem ele, qualquer um que descobrisse o `phone_number_id` (que não é
      // segredo: aparece em documentação, integração e suporte) injetava
      // mensagem falsa dentro da loja — criando cliente, conversa e lead em
      // nome de gente que nunca escreveu. O formato simulado já tinha sido
      // fechado assim em 07/08/2026; este ficou aberto.
      //
      // Agora é o contrário: sem App Secret configurado, NADA entra. A porta
      // do WhatsApp oficial só abre para quem prova que é a Meta.
      // O REGISTRO TEM FREIO. Quem bate aqui não está autenticado (é
      // justamente o ponto), e o `phone_number_id` não é segredo: sem freio,
      // qualquer um enchia a Central de Comunicação da loja — e o banco — com
      // milhares de "webhook.recusado". Um registro por janela conta a mesma
      // história sem virar arma (achado da revisão, 31/08/2026).
      const recusar = async (motivo: string) => {
        const desde = new Date(Date.now() - MS_ENTRE_AVISOS_DE_RECUSA);
        const jaAvisado = await db.commEvent.findFirst({
          where: {
            companyId: settings.companyId,
            type: "webhook.recusado",
            createdAt: { gt: desde },
          },
          select: { id: true },
        });
        if (jaAvisado) return;
        await db.commEvent
          .create({
            data: {
              companyId: settings.companyId,
              channel: "WHATSAPP",
              direction: "IN",
              type: "webhook.recusado",
              status: "ERRO",
              error: `Mensagem recusada na porta do WhatsApp oficial: ${motivo}.`,
              payload: raw.slice(0, 2000),
            },
          })
          .catch(() => {});
      };
      if (!settings.metaAppSecret) {
        // silêncio aqui seria o defeito de novo: fica registrado para a loja
        // descobrir POR QUE as mensagens não estão entrando
        await recusar("a loja não tem o App Secret da Meta configurado");
        continue;
      }
      const appSecret = decryptSecret(settings.metaAppSecret);
      const expected =
        "sha256=" +
        crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
      const assinaturaOk =
        Boolean(signature) &&
        signature!.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature!), Buffer.from(expected));
      if (!assinaturaOk) {
        await recusar("a assinatura da requisição não confere");
        continue;
      }

      const contactName = value.contacts?.[0]?.profile?.name;

      for (const msg of value.messages ?? []) {
        if (!msg.from) continue;
        const kind = (msg.type ?? "text").toUpperCase();
        const mediaType = ["IMAGE", "AUDIO", "VIDEO", "DOCUMENT"].includes(kind)
          ? (kind as "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT")
          : undefined;
        const text =
          msg.text?.body ??
          msg.button?.text ??
          msg.interactive?.button_reply?.title ??
          msg.interactive?.list_reply?.title ??
          msg.image?.caption ??
          msg.video?.caption ??
          msg.document?.caption ??
          (mediaType
            ? { IMAGE: "📷 Foto recebida", AUDIO: "🎙️ Áudio recebido", VIDEO: "🎬 Vídeo recebido", DOCUMENT: `📄 ${msg.document?.filename ?? "Documento recebido"}` }[mediaType]
            : "(mensagem)");
        try {
          await receiveMessage(settings.companyId, {
            channel: "WHATSAPP",
            phone: msg.from,
            name: contactName,
            text: text ?? "(mensagem)",
            mediaType,
            fileName: msg.document?.filename,
            externalId: msg.id,
          });
        } catch {
          // nunca derruba o webhook — a Meta reenvia se responder erro
        }
      }

      for (const st of value.statuses ?? []) {
        if (!st.id || !st.status) continue;
        const mapped =
          st.status === "delivered"
            ? ("ENTREGUE" as const)
            : st.status === "read"
              ? ("LIDA" as const)
              : st.status === "failed"
                ? ("FALHOU" as const)
                : null;
        if (!mapped) continue;
        try {
          await updateDeliveryStatus(
            settings.companyId,
            st.id,
            mapped,
            st.errors?.[0]?.message
          );
        } catch {
          /* idem */
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // 1) formato oficial da Meta Cloud API
  const metaResponse = await handleMetaPayload(
    raw,
    req.headers.get("x-hub-signature-256")
  );
  if (metaResponse) return metaResponse;

  // 2) formato simulado (testes internos) — protegido por INTAKE_SECRET.
  // FAIL-CLOSED (auditoria 07/08/2026): sem a env, o formato simulado ficava
  // aberto para injetar mensagem/recibo em qualquer loja. O WhatsApp REAL
  // (Meta/Evolution) já retornou acima; aqui, sem segredo, nega.
  const secret = process.env.INTAKE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Formato simulado desativado." },
      { status: 503 }
    );
  }
  if (req.headers.get("x-intake-token") !== secret) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();

  // recibo de status (entregue/lida/falhou)
  const statusParsed = statusSchema.safeParse(body);
  if (statusParsed.success) {
    const company = await db.company.findUnique({
      where: { slug: statusParsed.data.company },
    });
    if (!company) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }
    const updated = await updateDeliveryStatus(
      company.id,
      statusParsed.data.statusUpdate.externalId,
      statusParsed.data.statusUpdate.status,
      statusParsed.data.statusUpdate.error
    );
    return NextResponse.json({ ok: true, updated: Boolean(updated) });
  }

  // mensagem recebida
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const company = await db.company.findUnique({
    where: { slug: parsed.data.company },
  });
  if (!company) {
    return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  }
  // loja suspensa não ingere mensagem (200 mudo: nada a reprocessar)
  if (company.suspended) return NextResponse.json({ ok: true, suspenso: true });

  const result = await receiveMessage(company.id, {
    channel: "WHATSAPP",
    phone: parsed.data.phone,
    name: parsed.data.name,
    text: parsed.data.text,
    mediaType: parsed.data.mediaType,
    mediaUrl: parsed.data.mediaUrl,
    fileName: parsed.data.fileName,
    externalId: parsed.data.externalId,
  });

  return NextResponse.json({
    ok: true,
    isNewLead: result.isNewLead,
    conversationId: result.conversation?.id,
  });
}
