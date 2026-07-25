import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { blingEnv, blingAuthorizeUrl } from "@/lib/bling";

/** Inicia a conexão: manda a lojista autorizar o app no Bling dela. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    if (!blingEnv().configured) {
      return NextResponse.json(
        { error: "Integração Bling ainda não ativada pela plataforma (BLING_CLIENT_ID/SECRET)." },
        { status: 503 }
      );
    }
    return NextResponse.redirect(blingAuthorizeUrl(user.companyId));
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
