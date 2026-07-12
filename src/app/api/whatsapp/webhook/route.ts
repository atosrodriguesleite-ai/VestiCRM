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

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }

  // compara com o verify token de qualquer empresa configurada
  const all = await db.commSettings.findMany({
    where: { verifyToken: { not: null } },
  });
  const match = all.some((s) => decryptSecret(s.verifyToken!) === token);
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

      // assinatura: se o App Secret está configurado, exige e valida
      if (settings.metaAppSecret) {
        const appSecret = decryptSecret(settings.metaAppSecret);
        const expected =
          "sha256=" +
          crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
        const ok =
          signature &&
          signature.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        if (!ok) continue; // assinatura inválida: ignora silenciosamente
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

  // 2) formato simulado (testes internos) — protegido por INTAKE_SECRET
  const secret = process.env.INTAKE_SECRET;
  if (secret && req.headers.get("x-intake-token") !== secret) {
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
