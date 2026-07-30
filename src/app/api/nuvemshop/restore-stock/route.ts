import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { reconstructStock, applyStockRestore } from "@/lib/stock-restore";

/**
 * Recuperar o estoque de antes da importação da Nuvemshop.
 *  • GET  → prévia (o que seria restaurado; nada é gravado)
 *  • POST → aplica a restauração (grava e registra o movimento)
 */

export async function GET() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const preview = await reconstructStock(user.companyId);
    return NextResponse.json(preview);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const alterados = await applyStockRestore(user.companyId, user.name);
    return NextResponse.json({ ok: true, alterados });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
