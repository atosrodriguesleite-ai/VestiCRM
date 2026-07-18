import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { syncAbandonedCheckouts, syncProducts } from "@/lib/nuvemshop";

export const maxDuration = 60;

/** Sincronização completa sob demanda (produtos + carrinhos abandonados). */
export async function POST() {
  try {
    const user = await requireUser();
    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const produtos = await syncProducts(user.companyId);
    const carrinhos = await syncAbandonedCheckouts(user.companyId);
    return NextResponse.json({
      ok: produtos.ok,
      produtos: produtos.produtos,
      carrinhosNovos: carrinhos.novos,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
