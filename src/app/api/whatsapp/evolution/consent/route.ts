import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import {
  TERMO_WA_SHA,
  TERMO_WA_VERSAO,
} from "@/lib/comm/evolution";

/**
 * Registra o aceite do termo do WhatsApp sem API oficial. Sem este registro
 * o QR Code nunca é liberado. O registro é permanente e aparece no painel
 * do Super Admin (tela Lojas).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { error: "Apenas o administrador da loja pode aceitar o termo." },
        { status: 403 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as { aceito?: boolean };
    if (body.aceito !== true) {
      return NextResponse.json({ error: "Marque o aceite do termo." }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "desconhecido";

    const consent = await db.whatsappConsent.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        termVersion: TERMO_WA_VERSAO,
        termSha: TERMO_WA_SHA,
        ip,
        userAgent: req.headers.get("user-agent") ?? "desconhecido",
      },
    });
    return NextResponse.json(
      { ok: true, acceptedAt: consent.acceptedAt },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
