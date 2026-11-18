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
    // a loja é limpa ANTES do logout (RN-106): o "fechou" (401) que o logout
    // provoca chega ao webhook com o token antigo, que já não existe — e é
    // ignorado. Na ordem inversa ele virava queda no histórico e alarme
    // "WhatsApp desconectou" para quem acabou de apertar Desconectar.
    await db.commSettings.updateMany({
      where: { companyId: user.companyId },
      data: {
        evolutionStatus: "DESCONECTADO",
        evolutionPhone: null,
        evolutionInstance: null,
        evolutionWebhookToken: null,
        // RN-106: o envio sem eco desta conexão não vale para a próxima
        envioSemEcoDesde: null,
        // …e a prova de que o servidor avisa os envios é DESTA conexão: a
        // próxima arma de novo no primeiro eco dela, e é reassinada (achado
        // da revisão — a prova velha deixaria o alarme falso voltar)
        ecoDoEnvioVistoEm: null,
        evolutionWebhookEventos: null,
        ...(settings?.activeProvider === "EVOLUTION" ? { activeProvider: "MOCK" } : {}),
      },
    });
    if (settings?.evolutionInstance) {
      await evoLogout(settings.evolutionInstance).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
