import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { registrarPrimeiraConexao } from "@/lib/comm/primeira-conexao";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { encryptSecret, maskSecret } from "@/lib/crypto";

/**
 * Credenciais da Communication Engine.
 * Segurança: valores sensíveis são criptografados (AES-256-GCM) antes de
 * gravar; o GET devolve apenas máscaras — tokens NUNCA voltam inteiros ao
 * navegador. Toda alteração gera registro de auditoria (quem + quais campos).
 */

const SECRET_FIELDS = [
  "metaAppSecret",
  "verifyToken",
  "accessToken",
  "webhookSecret",
  "telegramBotToken",
  "smtpPassword",
] as const;

const schema = z.object({
  activeProvider: z.enum(["MOCK", "CLOUD_API"]).optional(),
  metaAppId: z.string().regex(/^\d*$/, "App ID deve ser numérico").nullable().optional(),
  metaAppSecret: z.string().min(16).nullable().optional(),
  businessManagerId: z.string().nullable().optional(),
  phoneNumberId: z.string().regex(/^\d*$/, "Phone Number ID deve ser numérico").nullable().optional(),
  verifyToken: z.string().min(6).nullable().optional(),
  accessToken: z.string().min(20).nullable().optional(),
  webhookSecret: z.string().min(6).nullable().optional(),
  instagramAccountId: z.string().nullable().optional(),
  facebookPageId: z.string().nullable().optional(),
  telegramBotToken: z.string().min(10).nullable().optional(),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().positive().max(65535).nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpPassword: z.string().min(4).nullable().optional(),
  catalogLinkMsg: z.string().max(500).nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const s = await db.commSettings.findUnique({
      where: { companyId: user.companyId },
    });
    const audits = await db.commAudit.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json({
      settings: s
        ? {
            activeProvider: s.activeProvider,
            metaAppId: s.metaAppId,
            metaAppSecret: maskSecret(s.metaAppSecret),
            businessManagerId: s.businessManagerId,
            phoneNumberId: s.phoneNumberId,
            verifyToken: maskSecret(s.verifyToken),
            accessToken: maskSecret(s.accessToken),
            webhookSecret: maskSecret(s.webhookSecret),
            instagramAccountId: s.instagramAccountId,
            facebookPageId: s.facebookPageId,
            telegramBotToken: maskSecret(s.telegramBotToken),
            smtpHost: s.smtpHost,
            smtpPort: s.smtpPort,
            smtpUser: s.smtpUser,
            smtpPassword: maskSecret(s.smtpPassword),
            catalogLinkMsg: s.catalogLinkMsg,
          }
        : { activeProvider: "MOCK" },
      audits: audits.map((a) => ({
        id: a.id,
        userName: a.userName,
        action: a.action,
        fields: a.fields,
        createdAt: a.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const [field, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      changedFields.push(field);
      if (
        typeof value === "string" &&
        (SECRET_FIELDS as readonly string[]).includes(field)
      ) {
        data[field] = encryptSecret(value);
      } else {
        data[field] = value;
      }
    }
    if (changedFields.length === 0) {
      return NextResponse.json({ ok: true });
    }

    await db.commSettings.upsert({
      where: { companyId: user.companyId },
      update: data,
      create: { companyId: user.companyId, ...data },
    });
    // escolher a API oficial é "a loja passou a ter WhatsApp": carimbo
    // da primeira conexão, que nunca é apagado (RN-049)
    if (data.activeProvider === "CLOUD_API") await registrarPrimeiraConexao(user.companyId);

    // auditoria: registra quem alterou e quais campos (nunca os valores)
    await db.commAudit.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userName: user.name,
        action: "Atualizou credenciais de comunicação",
        fields: changedFields.join(", "),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
