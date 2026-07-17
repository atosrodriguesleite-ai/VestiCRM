import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { evoLogout } from "@/lib/comm/evolution";

/** Desconecta o WhatsApp da loja e volta o canal para o modo simulado. */
export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const settings = await db.commSettings.findUnique({
      where: { companyId: user.companyId },
    });
    if (settings?.evolutionInstance) {
      await evoLogout(settings.evolutionInstance).catch(() => {});
    }
    await db.commSettings.updateMany({
      where: { companyId: user.companyId },
      data: {
        evolutionStatus: "DESCONECTADO",
        evolutionPhone: null,
        evolutionInstance: null,
        evolutionWebhookToken: null,
        ...(settings?.activeProvider === "EVOLUTION" ? { activeProvider: "MOCK" } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
