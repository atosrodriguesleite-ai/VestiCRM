import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { nuvemshopEnv, signState } from "@/lib/nuvemshop";

/** Inicia a conexão: manda o lojista autorizar o app na Nuvemshop dele. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const { clientId, authBase, configured } = nuvemshopEnv();
    if (!configured) {
      return NextResponse.json(
        { error: "Integração Nuvemshop ainda não ativada pela plataforma." },
        { status: 503 }
      );
    }
    const url = `${authBase}/apps/${clientId}/authorize?state=${signState(user.companyId)}`;
    return NextResponse.redirect(url);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
