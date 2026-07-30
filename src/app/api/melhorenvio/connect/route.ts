import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { meEnv, meAuthorizeUrl } from "@/lib/melhorenvio";

/** Inicia a conexão: manda a lojista autorizar o app no Melhor Envio dela. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    // módulo pago à parte: só loja com a chave ligada consegue conectar
    const company = await db.company.findUnique({
      where: { id: user.companyId },
      select: { shippingEnabled: true },
    });
    if (!company?.shippingEnabled) {
      return NextResponse.json(
        { error: "Módulo Envios não contratado. Fale com o AtacadoPro." },
        { status: 403 }
      );
    }
    if (!meEnv().configured) {
      return NextResponse.json(
        {
          error:
            "Envios ainda não ativados pela plataforma (MELHOR_ENVIO_CLIENT_ID/SECRET).",
        },
        { status: 503 }
      );
    }
    return NextResponse.redirect(meAuthorizeUrl(user.companyId));
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
