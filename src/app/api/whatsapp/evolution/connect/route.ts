import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import {
  evolutionEnv,
  evoCreateInstance,
  evoConnect,
  TERMO_WA_VERSAO,
} from "@/lib/comm/evolution";

/**
 * Inicia a conexão do WhatsApp sem API oficial: garante a instância da loja
 * no servidor Evolution (webhook já apontado pra cá) e devolve o QR Code.
 * Pré-requisito inegociável: termo aceito e registrado.
 */
export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (!evolutionEnv().configured) {
      return NextResponse.json(
        { error: "O servidor de conexão ainda não foi configurado pela plataforma." },
        { status: 503 }
      );
    }
    const consent = await db.whatsappConsent.findFirst({
      where: { companyId: user.companyId, termVersion: TERMO_WA_VERSAO },
    });
    if (!consent) {
      return NextResponse.json(
        { error: "Aceite o termo de uso antes de conectar." },
        { status: 403 }
      );
    }

    let settings = await db.commSettings.upsert({
      where: { companyId: user.companyId },
      update: {},
      create: { companyId: user.companyId },
    });

    if (!settings.evolutionInstance || !settings.evolutionWebhookToken) {
      const instance = `ap_${user.companyId.slice(-8)}_${crypto.randomBytes(3).toString("hex")}`;
      const token = crypto.randomBytes(24).toString("hex");
      settings = await db.commSettings.update({
        where: { companyId: user.companyId },
        data: { evolutionInstance: instance, evolutionWebhookToken: token },
      });
    }

    const created = await evoCreateInstance(
      settings.evolutionInstance!,
      settings.evolutionWebhookToken!
    );
    // 403/409 = instância já existe no servidor — seguimos para o QR
    if (!created.ok && ![403, 409].includes(created.status)) {
      return NextResponse.json(
        { error: "Não foi possível preparar a conexão. Tente novamente." },
        { status: 502 }
      );
    }

    const qr = await evoConnect(settings.evolutionInstance!);
    if (!qr.ok || !qr.data?.base64) {
      return NextResponse.json(
        { error: "Não foi possível gerar o QR Code. Tente novamente." },
        { status: 502 }
      );
    }

    await db.commSettings.update({
      where: { companyId: user.companyId },
      data: { evolutionStatus: "AGUARDANDO_QR" },
    });

    return NextResponse.json({ qr: qr.data.base64 });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
