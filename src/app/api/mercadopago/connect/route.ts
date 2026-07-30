import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { mpEnv, mpAuthorizeUrl } from "@/lib/mercadopago";

/** Inicia a conexão: manda a lojista autorizar o app no Mercado Pago dela. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (!mpEnv().configured) {
      return NextResponse.json(
        { error: "Pagamentos ainda não ativados pela plataforma (MP_CLIENT_ID/SECRET)." },
        { status: 503 }
      );
    }
    return NextResponse.redirect(mpAuthorizeUrl(user.companyId));
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
